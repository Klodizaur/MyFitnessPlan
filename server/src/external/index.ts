/**
 * Registry of playlist resolvers.
 *
 * ---------------------------------------------------------------------------
 * REMOVING yt-dlp
 * ---------------------------------------------------------------------------
 * If yt-dlp ever stops working and you want it gone, the feature is designed to
 * be deleted rather than migrated. Importing is the *only* thing that needs it —
 * playback uses YouTube's embed directly — so videos already imported keep
 * playing, and existing plans keep working. You only lose the ability to add
 * new playlists.
 *
 *   1. Empty the RESOLVERS array below (or delete `./ytdlp.js` and its import).
 *   2. Delete the yt-dlp block from desktop/scripts/stage.mjs.
 *   3. Delete the `.build/yt-dlp` entry from desktop/electron-builder.yml.
 *   4. Delete the ytdlpDir() line from serverEnv() in desktop/main.js.
 *
 * With an empty array, /api/external/status reports unavailable, the client
 * hides its import button, and nothing else in the app changes. Steps 2-4 just
 * stop shipping a binary nobody calls any more.
 * ---------------------------------------------------------------------------
 */
import { PlaylistResolver } from './types.js';
import ytdlp from './ytdlp.js';

const RESOLVERS: PlaylistResolver[] = [ytdlp];

/** The resolver that handles this URL, or null when none recognises it. */
export function resolverFor(url: string): PlaylistResolver | null {
  return RESOLVERS.find(r => r.canResolve(url)) || null;
}

/** True when at least one resolver is registered and its tool actually runs. */
export async function importAvailable(): Promise<boolean> {
  const checks = await Promise.all(RESOLVERS.map(r => r.isAvailable()));
  return checks.some(Boolean);
}

/** `videos.source` values that came from an external provider. */
export const EXTERNAL_SOURCES: string[] = RESOLVERS.map(r => r.source);

export * from './types.js';
