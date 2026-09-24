import { Dispatch, SetStateAction } from 'react';
import { Video } from '../types/video';

/**
 * Star or un-star a video. Optimistic: the heart answers the tap, and the change
 * is rolled back if the server refuses it.
 */
export async function toggleVideoFavorite(video: Video, setVideos: Dispatch<SetStateAction<Video[]>>) {
  const next = !video.is_favorite;
  const apply = (value: boolean) =>
    setVideos(prev => prev.map(v => (v.id === video.id ? { ...v, is_favorite: value } : v)));

  apply(next);
  try {
    const res = await fetch(`/api/library/videos/${encodeURIComponent(video.id)}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: next }),
    });
    if (!res.ok) throw new Error('failed');
  } catch {
    apply(Boolean(video.is_favorite));
  }
}
