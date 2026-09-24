/**
 * Playback capability layer — "direct play first".
 * ------------------------------------------------
 * A file that the client on the other end can already decode is served exactly
 * as it sits on disk: byte ranges, instant seeking, no CPU burned. That is
 * direct play, and it stays the default for everything.
 *
 * Only when the client demonstrably cannot decode the file (an MKV or an AC-3
 * track on an iPad, say) do we fall back to converting on the fly, and even then
 * we copy whichever of the two streams the client *can* handle rather than
 * re-encoding both.
 *
 * The decision is per-client, because the two clients that matter have different
 * abilities: the desktop window is Chromium, and a phone or tablet on the LAN is
 * Safari. Guessing one profile for both would either transcode files the desktop
 * plays natively or hand an iPhone a container it cannot open.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import db from './db.js';

const execPromise = promisify(exec);

// --- What each client can decode --------------------------------------------

export type ClientKind = 'apple' | 'chromium';

export interface ClientProfile {
  kind: ClientKind;
  containers: Set<string>;
  video: Set<string>;
  audio: Set<string>;
  /** Apple clients play HLS natively; Chromium needs a progressive stream. */
  transcodeMode: 'hls' | 'stream';
}

/**
 * Safari (iOS, iPadOS, macOS). HEVC is included deliberately — Apple hardware
 * decodes it, and re-encoding a 4K HEVC file the device plays natively would be
 * the exact mistake this module exists to avoid.
 */
const APPLE: ClientProfile = {
  kind: 'apple',
  containers: new Set(['.mp4', '.m4v', '.mov']),
  video: new Set(['h264', 'hevc']),
  audio: new Set(['aac', 'mp3', 'alac']),
  transcodeMode: 'hls',
};

/**
 * Chromium — the desktop window, and any Chrome/Firefox/Edge browser pointed at
 * the shared address. WebM/Ogg codecs are in; Matroska and AVI are not, which is
 * why those files fail to play today.
 */
const CHROMIUM: ClientProfile = {
  kind: 'chromium',
  containers: new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv']),
  video: new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']),
  audio: new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']),
  transcodeMode: 'stream',
};

/**
 * Which profile a request belongs to. Safari is identified by elimination: every
 * Chromium browser on Apple hardware also says "Safari" in its UA, so the
 * Chrome/Edge/Firefox markers have to be ruled out first.
 */
export function clientProfile(userAgent: string | undefined): ClientProfile {
  const ua = userAgent || '';
  const isApplePlatform = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  const isOtherEngine = /Chrome|Chromium|CriOS|Edg|EdgiOS|Firefox|FxiOS|OPR/i.test(ua);
  // iOS forces every browser onto WebKit, so an iPhone is an Apple client no
  // matter which app is asking.
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  if (isIos || (isApplePlatform && !isOtherEngine)) return APPLE;
  return CHROMIUM;
}

// --- Probing -----------------------------------------------------------------

export interface StreamInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  /** Runtime in whole seconds, or null when ffmpeg could not report one. */
  durationSeconds: number | null;
}

/**
 * Reads the codecs and runtime out of a file with `ffmpeg -i`, the same trick
 * the library scan uses: ffmpeg exits non-zero without an output file but still
 * prints the stream table to stderr, and only ffmpeg is bundled with the desktop
 * app (ffprobe is not).
 */
export async function probeMedia(filePath: string): Promise<StreamInfo> {
  let output = '';
  try {
    const { stderr } = await execPromise(`ffmpeg -i "${filePath}"`);
    output = stderr;
  } catch (err: any) {
    output = err?.stderr || '';
  }

  const video = output.match(/Stream #\d+:\d+.*: Video: ([a-zA-Z0-9_]+)/);
  const audio = output.match(/Stream #\d+:\d+.*: Audio: ([a-zA-Z0-9_]+)/);
  const time = output.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const seconds = time
    ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])
    : NaN;

  return {
    videoCodec: video ? normalizeCodec(video[1]) : null,
    audioCodec: audio ? normalizeCodec(audio[1]) : null,
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
  };
}

/** ffmpeg's decoder names differ from the codec names the profiles use. */
function normalizeCodec(name: string): string {
  const n = name.toLowerCase();
  if (n === 'h265' || n === 'hev1' || n === 'hvc1') return 'hevc';
  if (n === 'avc1') return 'h264';
  if (n === 'mp3float') return 'mp3';
  return n;
}

/**
 * Cached probe. Codecs are a property of the file, so the result is written back
 * to the row and not read again — a library pays the ffmpeg cost once per video,
 * the first time something asks to play it. Runtime is filled in at the same
 * time when the library scan never got one.
 */
export async function mediaForVideo(videoId: string, filePath: string): Promise<StreamInfo> {
  const row = db
    .prepare('SELECT video_codec, audio_codec, codec_probed, duration_seconds FROM videos WHERE id = ?')
    .get(videoId) as
    | { video_codec: string | null; audio_codec: string | null; codec_probed: number | null; duration_seconds: number | null }
    | undefined;

  // A missing runtime is worth re-probing: it is what the HLS playlist is built
  // from, so a file the scan could not measure would otherwise be stuck without
  // the one fallback Safari can use. Files this affects are rare, and the cost is
  // a single ffmpeg header read.
  if (row?.codec_probed && row.duration_seconds) {
    return {
      videoCodec: row.video_codec,
      audioCodec: row.audio_codec,
      durationSeconds: row.duration_seconds,
    };
  }

  const info = await probeMedia(filePath);
  db.prepare('UPDATE videos SET video_codec = ?, audio_codec = ?, codec_probed = 1 WHERE id = ?')
    .run(info.videoCodec, info.audioCodec, videoId);
  // Never overwrite a runtime the scan already established.
  const duration = row?.duration_seconds || info.durationSeconds;
  if (!row?.duration_seconds && info.durationSeconds) {
    db.prepare('UPDATE videos SET duration_seconds = ? WHERE id = ?').run(info.durationSeconds, videoId);
  }
  return { ...info, durationSeconds: duration };
}

// --- The decision ------------------------------------------------------------

export interface PlaybackDecision {
  /** 'direct' streams the file untouched; the others convert on the fly. */
  mode: 'direct' | 'hls' | 'stream';
  /** Short machine-readable reason, surfaced in the UI and the logs. */
  reason: 'direct' | 'container' | 'video_codec' | 'audio_codec' | 'unknown_codecs';
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** Which streams the fallback can copy straight through instead of re-encoding. */
export interface CopyPlan {
  video: boolean;
  audio: boolean;
}

export function decidePlayback(
  filePath: string,
  info: StreamInfo,
  profile: ClientProfile
): PlaybackDecision {
  const container = path.extname(filePath).toLowerCase();
  const containerOk = profile.containers.has(container);
  // An unreadable probe is not a reason to transcode a file the container check
  // already vouches for — an .mp4 that ffmpeg could not describe is still far
  // more likely to play than to fail, and direct play degrades gracefully.
  const videoOk = info.videoCodec === null ? containerOk : profile.video.has(info.videoCodec);
  const audioOk = info.audioCodec === null ? true : profile.audio.has(info.audioCodec);

  const base = {
    container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
  };

  if (containerOk && videoOk && audioOk) {
    return { mode: 'direct', reason: 'direct', ...base };
  }

  // Which of the three is reported when more than one is wrong: the container is
  // the most fundamental and the most useful thing to say ("this device can't
  // open an MKV" beats naming a codec the user then has to look up).
  const reason: PlaybackDecision['reason'] = !containerOk
    ? 'container'
    : !videoOk
      ? 'video_codec'
      : 'audio_codec';

  return { mode: profile.transcodeMode, reason, ...base };
}

/**
 * What the fallback may copy, given the shape of the output it is producing.
 *
 * This depends on the OUTPUT, not on who is asking — which is why it is separate
 * from the decision above. An HLS segment is generated by its own ffmpeg run
 * seeking to a fixed offset, and a stream copy can only begin at a keyframe, so
 * a copied segment would start earlier than the playlist says it does and drift
 * further out with every segment. Re-encoding makes each segment begin exactly
 * where it claims to. Audio has no such constraint and is copied whenever
 * MPEG-TS can carry it and the client can decode it.
 */
export function copyPlan(
  info: StreamInfo,
  target: 'hls' | 'stream',
  profile: ClientProfile
): CopyPlan {
  const videoOk = info.videoCodec !== null && profile.video.has(info.videoCodec);
  const audioOk = info.audioCodec !== null && profile.audio.has(info.audioCodec);

  if (target === 'hls') {
    return {
      video: false,
      audio: audioOk && (info.audioCodec === 'aac' || info.audioCodec === 'mp3'),
    };
  }

  return {
    // Only these two fit an MP4 container without surprises; VP8/VP9/AV1 sources
    // that got here are being re-encoded anyway.
    video: videoOk && (info.videoCodec === 'h264' || info.videoCodec === 'hevc'),
    audio: audioOk,
  };
}
