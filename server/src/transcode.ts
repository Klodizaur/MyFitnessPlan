/**
 * On-the-fly conversion for files a client cannot decode as they are.
 * ------------------------------------------------------------------
 * This is the fallback, never the default: `decidePlayback` in playback.ts sends
 * everything it can down the direct-play path first, and only what is genuinely
 * unplayable arrives here.
 *
 * Two shapes, because the two clients want different things:
 *
 *   HLS (Apple)      — Safari plays .m3u8 natively but will not play a
 *                      progressive stream of unknown length. The playlist is
 *                      computed from the runtime, and each segment is produced
 *                      by its own short ffmpeg run seeking to a fixed offset.
 *                      Nothing is kept on disk and seeking works, because any
 *                      segment can be requested at any time, in any order.
 *
 *   Progressive MP4  — Chromium has no native HLS but is happy to play a
 *   (Chromium)         fragmented MP4 arriving over a chunked response. Seeking
 *                      is handled by restarting the encode at `?start=`.
 *
 * Both copy whatever streams the client can already decode instead of re-encoding
 * them, so a file that only fails on its container or its audio track costs a
 * fraction of a full conversion.
 */
import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import type { CopyPlan } from './playback.js';

/** One HLS segment, in seconds. Six is the usual compromise: short enough to
 *  start quickly, long enough that per-segment ffmpeg startup is not the cost. */
export const SEGMENT_SECONDS = 6;

/** Cap on encoded width, so a 4K source does not saturate a phone or the Wi-Fi. */
const MAX_WIDTH = 1920;

export function segmentCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / SEGMENT_SECONDS));
}

/**
 * A complete VOD playlist, written up front from the known runtime rather than
 * from segments that exist. Every segment is generated on request, so the whole
 * file is seekable the moment playback starts.
 */
export function hlsPlaylist(durationSeconds: number, segmentUrl: (index: number) => string): string {
  const count = segmentCount(durationSeconds);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (let i = 0; i < count; i++) {
    const remaining = durationSeconds - i * SEGMENT_SECONDS;
    const length = Math.min(SEGMENT_SECONDS, remaining);
    lines.push(`#EXTINF:${length.toFixed(3)},`, segmentUrl(i));
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

/** Video encoder arguments, shared by both output shapes. */
function videoArgs(copy: CopyPlan): string[] {
  if (copy.video) return ['-c:v', 'copy'];
  return [
    '-c:v', 'libx264',
    // Fast enough to stay ahead of playback on a laptop, and the quality
    // difference at CRF 21 is not something you notice in a workout video.
    '-preset', 'veryfast',
    '-crf', '21',
    // Baseline-friendly settings so older iPads do not refuse the stream.
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    // Only ever scale down; `-2` keeps the height even, which H.264 requires.
    '-vf', `scale='min(${MAX_WIDTH},iw)':-2`,
  ];
}

/** Audio encoder arguments. Stereo AAC is the safe target for every client. */
function audioArgs(copy: CopyPlan, hasAudio: boolean): string[] {
  if (!hasAudio) return ['-an'];
  if (copy.audio) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', '160k', '-ac', '2'];
}

/** stdin is closed, stdout carries the media, stderr carries ffmpeg's complaints. */
export type FfmpegProcess = ChildProcessByStdio<null, Readable, Readable>;

function run(args: string[]): FfmpegProcess {
  // `-nostdin` matters: without it ffmpeg reads the parent's stdin and can hang
  // the whole server process.
  return spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * One MPEG-TS segment of the HLS ladder.
 *
 * `-ss` before `-i` is the fast input seek, and it rebases timestamps to zero;
 * `-output_ts_offset` puts them back where the playlist expects them, which is
 * what keeps independently-generated segments joining up without a stutter at
 * every boundary.
 */
export function hlsSegment(filePath: string, index: number, copy: CopyPlan, hasAudio: boolean) {
  const start = index * SEGMENT_SECONDS;
  return run([
    '-ss', String(start),
    '-t', String(SEGMENT_SECONDS),
    '-i', filePath,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    ...videoArgs(copy),
    ...audioArgs(copy, hasAudio),
    // Seeking to `start` restarts the encoder, so the segment already opens on a
    // keyframe; forcing more would only inflate it.
    '-output_ts_offset', String(start),
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-f', 'mpegts',
    'pipe:1',
  ]);
}

/**
 * A fragmented MP4 from `start` onwards, for clients that stream progressively.
 * `empty_moov` lets playback begin before the encode finishes, and
 * `frag_keyframe` starts each fragment on a keyframe so the player can pick it up.
 */
export function progressiveMp4(filePath: string, startSeconds: number, copy: CopyPlan, hasAudio: boolean) {
  return run([
    ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
    '-i', filePath,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    ...videoArgs(copy),
    ...audioArgs(copy, hasAudio),
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ]);
}
