/**
 * How this device should play a given video.
 *
 * The answer comes from the server rather than being guessed here, because it
 * depends on what is actually inside the file — and it differs per device: the
 * same video is a direct play in the desktop window and a transcode on an iPad
 * reaching the app over the local network.
 */
export interface PlaybackPlan {
  /** 'direct' streams the untouched file; the others convert as they go. */
  mode: 'direct' | 'hls' | 'stream';
  /** What to put in the <video> src. */
  url: string;
  reason: 'direct' | 'container' | 'video_codec' | 'audio_codec' | 'unknown_codecs';
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  client: 'apple' | 'chromium';
}

/**
 * Ask the server what to do with a video.
 *
 * Returns null when the question could not be answered — the caller then falls
 * back to the plain file URL, which is what the app always did and what works
 * for the overwhelming majority of libraries.
 */
export async function resolvePlayback(videoId: string): Promise<PlaybackPlan | null> {
  try {
    const res = await fetch(`/api/playback/${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    return (await res.json()) as PlaybackPlan;
  } catch {
    return null;
  }
}
