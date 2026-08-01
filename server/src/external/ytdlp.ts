/**
 * THE ONLY FILE THAT KNOWS yt-dlp EXISTS.
 *
 * It is used purely to read *metadata* for a public playlist (IDs, titles,
 * durations, thumbnails) — never to download media. Playback goes through
 * YouTube's own embed, so ads serve normally and views still count.
 *
 * To drop yt-dlp entirely, see the removal note in `index.ts`.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ExternalVideo, PlaylistResolveError, PlaylistResolver, ResolvedPlaylist } from './types.js';

const execFilePromise = promisify(execFile);

/** Upper bound on one import, so a 5000-video playlist can't wedge the app. */
const MAX_ITEMS = 500;

/** yt-dlp on a long playlist can take a while; well under a user's patience. */
const RESOLVE_TIMEOUT_MS = 90_000;

/** A big playlist's JSON is genuinely large. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Videos per description batch. Small enough that one bad video costs little. */
const DESCRIPTION_BATCH_SIZE = 10;

/** Per batch, allowing for a slow extraction on each video in it. */
const DESCRIPTION_TIMEOUT_MS = 120_000;

/**
 * Entries yt-dlp emits for videos that are gone. They have a real ID but no
 * watchable content, so importing them would create dead rows in a plan.
 */
const PLACEHOLDER_TITLES = new Set([
  '[private video]',
  '[deleted video]',
  '[unavailable video]',
  '[video unavailable]',
]);

function isYouTubeUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'
      || host === 'music.youtube.com' || host === 'youtube-nocookie.com';
  } catch {
    return false;
  }
}

/** Highest-resolution thumbnail yt-dlp listed, else YouTube's predictable path. */
function pickThumbnail(entry: any, videoId: string): string | null {
  const thumbs = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
  const usable = thumbs.filter((t: any) => typeof t?.url === 'string');
  if (usable.length > 0) {
    const best = usable.reduce((a: any, b: any) => ((b.width || 0) > (a.width || 0) ? b : a));
    return best.url;
  }
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/**
 * Stable album key for an import.
 *
 * Prefers the playlist ID yt-dlp reports, then the `list=` parameter from the
 * URL the user pasted. A bare video URL has neither, so it groups under that
 * video's own ID — one album per one-off video, which is at least predictable.
 */
function playlistIdFor(parsed: any, url: string, firstVideoId: string): string {
  const reported = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
  const isPlaylist = Array.isArray(parsed?.entries);
  if (isPlaylist && reported) return reported;

  try {
    const listParam = new URL(url).searchParams.get('list');
    if (listParam) return listParam;
  } catch {
    // Fall through to the video ID.
  }

  return reported || firstVideoId;
}

function toExternalVideo(entry: any): ExternalVideo | null {
  const externalId = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!externalId) return null;

  const rawTitle = typeof entry?.title === 'string' ? entry.title.trim() : '';
  if (!rawTitle || PLACEHOLDER_TITLES.has(rawTitle.toLowerCase())) return null;

  const duration = Number(entry?.duration);

  return {
    externalId,
    title: rawTitle,
    url: `https://www.youtube.com/watch?v=${externalId}`,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    thumbnailUrl: pickThumbnail(entry, externalId),
  };
}

class YtDlpResolver implements PlaylistResolver {
  readonly source = 'youtube';

  /** Cached across calls — a bundled binary doesn't appear or vanish mid-run. */
  private availability: Promise<boolean> | null = null;

  isAvailable(): Promise<boolean> {
    if (!this.availability) {
      this.availability = execFilePromise('yt-dlp', ['--version'], { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    }
    return this.availability;
  }

  canResolve(url: string): boolean {
    return isYouTubeUrl(url);
  }

  async fetchDescriptions(externalIds: string[]): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>();
    if (externalIds.length === 0 || !(await this.isAvailable())) return descriptions;

    // Unlike listing a playlist, this extracts each video individually, so it
    // runs in small batches: one slow or unavailable video then costs a short
    // batch rather than the whole job.
    for (let i = 0; i < externalIds.length; i += DESCRIPTION_BATCH_SIZE) {
      const batch = externalIds.slice(i, i + DESCRIPTION_BATCH_SIZE);
      const urls = batch.map(id => `https://www.youtube.com/watch?v=${id}`);

      let stdout: string;
      try {
        // --dump-json (not --dump-single-json) emits one JSON object per line,
        // one per video, so a single failure doesn't invalidate the batch.
        const result = await execFilePromise('yt-dlp', [
          '--skip-download',
          '--dump-json',
          '--no-warnings',
          '--ignore-errors',
          ...urls,
        ], { timeout: DESCRIPTION_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES });
        stdout = result.stdout;
      } catch (err: any) {
        // --ignore-errors still exits non-zero when some videos failed, but the
        // successful ones are already on stdout, so use whatever arrived.
        stdout = String(err?.stdout || '');
      }

      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const video = JSON.parse(line);
          const id = typeof video?.id === 'string' ? video.id : '';
          const description = typeof video?.description === 'string' ? video.description.trim() : '';
          if (id && description) descriptions.set(id, description);
        } catch {
          // A truncated or non-JSON line; skip it.
        }
      }
    }

    return descriptions;
  }

  async resolve(url: string): Promise<ResolvedPlaylist> {
    if (!this.canResolve(url)) {
      throw new PlaylistResolveError('unsupported_url', 'Not a YouTube URL');
    }
    if (!(await this.isAvailable())) {
      throw new PlaylistResolveError('unavailable', 'yt-dlp is not available');
    }

    let stdout: string;
    try {
      // execFile (not exec) so the user-supplied URL is never seen by a shell.
      // --flat-playlist keeps this to one metadata request per playlist rather
      // than one per video.
      const result = await execFilePromise('yt-dlp', [
        '--flat-playlist',
        '--dump-single-json',
        '--no-warnings',
        '--ignore-errors',
        '--playlist-end', String(MAX_ITEMS + 1),
        url,
      ], { timeout: RESOLVE_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES });
      stdout = result.stdout;
    } catch (err: any) {
      const stderr = String(err?.stderr || '');
      // A private playlist surfaces as a bare "HTTP Error 403", with none of the
      // words you'd expect — so the status codes have to be matched directly, or
      // the most common user mistake gets reported as a network problem.
      const inaccessible = /\b40[34]\b|forbidden|private|unavailable|does not exist|not found|removed/i.test(stderr);
      if (inaccessible) {
        throw new PlaylistResolveError('not_found', 'Playlist not found, private or unlisted');
      }
      throw new PlaylistResolveError('failed', stderr.trim() || 'yt-dlp failed');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new PlaylistResolveError('failed', 'Could not read the playlist data');
    }

    // A playlist URL yields {entries:[...]}; a bare video URL yields the video.
    const rawEntries: any[] = Array.isArray(parsed?.entries) ? parsed.entries : [parsed];

    const items: ExternalVideo[] = [];
    const seen = new Set<string>();
    for (const entry of rawEntries) {
      const video = toExternalVideo(entry);
      if (!video || seen.has(video.externalId)) continue;
      seen.add(video.externalId);
      items.push(video);
    }

    if (items.length === 0) {
      throw new PlaylistResolveError('empty', 'No playable videos in that playlist');
    }

    const truncated = items.length > MAX_ITEMS;

    return {
      playlistId: playlistIdFor(parsed, url, items[0].externalId),
      title: typeof parsed?.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : 'YouTube playlist',
      items: truncated ? items.slice(0, MAX_ITEMS) : items,
      truncated,
    };
  }
}

export default new YtDlpResolver();
