import { useEffect, useRef } from 'react';

/**
 * YouTube playback for imported playlist videos.
 *
 * Uses the IFrame Player API rather than a bare <iframe> so the player can
 * report when a video ends — that drives the same auto-advance the local
 * <video> element gets from onEnded — and so keyboard shortcuts keep working.
 *
 * The API script is fetched from YouTube on first use and only when an external
 * video is actually opened, so a library of local files still plays offline.
 */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/** Shared across mounts: the API script must only ever be injected once. */
let apiPromise: Promise<any> | null = null;

function loadIframeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    // YouTube calls this global once the script finishes initialising. Chain any
    // existing handler so we never clobber another listener.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // let a later attempt retry once back online
      reject(new Error('Could not load the YouTube player'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

type Props = {
  /** YouTube video ID. */
  externalId: string;
  onEnded: () => void;
  onError: (message: string) => void;
  /** Receives the player instance so the page can drive keyboard shortcuts. */
  onReady?: (player: any) => void;
};

export default function YouTubeEmbed({ externalId, onEnded, onError, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // Keep the latest callbacks in refs so re-renders don't tear down the player.
  const handlers = useRef({ onEnded, onError, onReady });
  handlers.current = { onEnded, onError, onReady };

  useEffect(() => {
    let cancelled = false;

    loadIframeApi()
      .then(YT => {
        if (cancelled || !hostRef.current) return;

        playerRef.current = new YT.Player(hostRef.current, {
          videoId: externalId,
          playerVars: {
            autoplay: 1,
            rel: 0,          // don't trail unrelated channels' videos
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: (event: any) => handlers.current.onReady?.(event.target),
            onStateChange: (event: any) => {
              if (event.data === YT.PlayerState.ENDED) handlers.current.onEnded();
            },
            // 101/150 mean the uploader disabled embedding — the video exists
            // and plays on YouTube, just not inside another site. That is the
            // one failure users will actually hit, so it gets its own message.
            onError: (event: any) => {
              const embeddingBlocked = event.data === 101 || event.data === 150;
              handlers.current.onError(
                embeddingBlocked ? 'embed_blocked' : 'unavailable'
              );
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onError('offline');
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // The iframe may already be gone if YouTube tore it down first.
      }
      playerRef.current = null;
    };
  }, [externalId]);

  // YT.Player replaces this node with the iframe, so it needs a wrapper it can
  // fill rather than being the sized element itself.
  return (
    <div className="player-youtube">
      <div ref={hostRef} />
    </div>
  );
}
