import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, HardDrive, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import { useMetaLabels } from '../lib/labels';
import { formatDuration, stripVideoExt, useVideoTags } from '../lib/videoTags';
import type { Video } from '../types/video';
import Modal from '../components/modal/Modal';
import { VideoEditForm } from '../components/VideoMetadataEditor';
import '../styles/player.css';
import { videoStreamUrl } from '../lib/paths';
import { resolvePlayback, type PlaybackPlan } from '../lib/playback';
import { canFullscreen, enterFullscreen, exitFullscreen, fullscreenElement, onFullscreenChange } from '../lib/fullscreen';
import YouTubeGlyph from '../components/icons/YouTubeGlyph';
import YouTubeEmbed from '../components/YouTubeEmbed';
import LoopControl, { formatRest } from '../components/LoopControl';
import { addTvBackHandler, addTvKeyInterceptor, canOpenYouTubeApp, isTv, openYouTubeApp, tvKeepScreenOn, tvVideoOpen } from '../lib/tv';

type Step = { id: string; title: string; thumbnail: string | null; duration: number; done: boolean };

const SPEEDS = [1, 1.25, 1.5];

/**
 * TV mode: move the remote's focus to the rest countdown's Skip the moment it
 * appears — during a rest it is the only thing to do — and back to Play/Pause
 * when the rest ends. (Deliberately not done for "up next": it shows in a
 * video's last seconds, and OK must still pause then.)
 * Module-level so React calls it once per mount, not on every render.
 */
const focusRestSkipOnTv = (el: HTMLElement | null) => {
  if (!isTv) return;
  if (el) {
    el.focus({ preventScroll: true });
    return;
  }
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>('.pv-theater [data-tv-default]')?.focus({ preventScroll: true });
  });
};

export default function Player() {
  const { videoId, workoutId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set once the YouTube player is ready; used to route keyboard shortcuts.
  const ytPlayerRef = useRef<any>(null);
  const { t } = useTranslation();
  const [filename, setFilename] = useState('');
  const [videoPath, setVideoPath] = useState('');
  // 'local' plays from disk via <video>; anything else uses a provider embed.
  const [source, setSource] = useState<string>('local');
  const [externalId, setExternalId] = useState<string | null>(null);
  // The whole library record: tags, description and the edit form all read it.
  const [video, setVideo] = useState<Video | null>(null);
  const [editing, setEditing] = useState(false);
  // The up-next card can be waved away; it comes back for the next video.
  const [upNextHidden, setUpNextHidden] = useState(false);
  // Every video of today's workout, for the strip under the player. Empty when
  // the video is played on its own.
  const [steps, setSteps] = useState<Step[]>([]);
  // What the player itself reports, so the custom controls can draw it.
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  // 0-1, kept between videos and visits.
  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('playerVolume'));
      return Number.isFinite(saved) && saved >= 0 && saved <= 1 && localStorage.getItem('playerVolume') !== null ? saved : 1;
    } catch {
      return 1;
    }
  });
  const [error, setError] = useState<string | null>(null);
  // Why a YouTube video failed (embed_blocked, offline, unavailable), for the
  // TV's way out of it.
  const [errorReason, setErrorReason] = useState<string | null>(null);
  // External videos have no relative_path, so "has a path" can't double as
  // "finished loading" any more.
  const [isLoaded, setIsLoaded] = useState(false);
  const theaterRef = useRef<HTMLDivElement>(null);
  const [isMarking, setIsMarking] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [showMarkDone, setShowMarkDone] = useState(false);
  // Standalone mode: the video is played outside any plan workout (e.g. straight
  // from the Library). Marking done then logs a manual workout_log entry.
  const [standalone, setStandalone] = useState(false);
  const [standaloneWorkoutId, setStandaloneWorkoutId] = useState<string | null>(null);
  const [nextVideoId, setNextVideoId] = useState<string | null>(null);
  // How this device should play this file: straight from disk, or converted on
  // the fly because it can't decode it. `playbackReady` is separate from a null
  // plan, because "asked, and the server had no opinion" still means go ahead.
  const [playback, setPlayback] = useState<PlaybackPlan | null>(null);
  const [playbackReady, setPlaybackReady] = useState(false);
  const labels = useMetaLabels();
  const tagsFor = useVideoTags();

  // --- Loop + rest ---------------------------------------------------------
  // `loops` is the total number of passes the user asked for, counting the one
  // already playing when they set it up: "10 times" means 10 plays, not 10
  // repeats on top of the first. `passesDone` counts finished passes, so the
  // pass on screen is always passesDone + 1.
  const [loops, setLoops] = useState(0);
  const [restSeconds, setRestSeconds] = useState(60);
  // Separate from restSeconds: the pause after the LAST pass, before a
  // different video from the plan starts — often wanted longer than the
  // between-pass breather.
  const [nextRestSeconds, setNextRestSeconds] = useState(60);
  const [passesDone, setPassesDone] = useState(0);
  const [restLeft, setRestLeft] = useState<number | null>(null);
  // The end-of-video handler runs from player callbacks that can hold a stale
  // closure, so the count it reads lives in a ref alongside the state.
  const passesDoneRef = useRef(0);
  // What to do when the rest countdown reaches zero: replay, or move on.
  const restActionRef = useRef<(() => void) | null>(null);

  // Declared before the effects below, which depend on it.
  const isExternal = source !== 'local';

  useEffect(() => {
    fetch('/api/library/videos')
      .then(res => res.json())
      .then(data => {
        const vid = data.find((v: any) => v.id === videoId);
        if (vid) {
          setFilename(vid.filename);
          setVideoPath(vid.relative_path);
          setSource(vid.source || 'local');
          setExternalId(vid.external_id || null);
          setVideo(vid);
          setIsLoaded(true);
        } else {
          setError('Video not found in library');
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load video details');
      });

    // When the video is not part of a plan workout, offer a standalone "mark as
    // done" that writes a manual entry to the workout log. Check today's log to
    // restore the toggle state (and remember the entry id for un-marking).
    const loadStandaloneState = () => {
      setStandalone(true);
      fetch('/api/profile/history')
        .then(res => res.json())
        .then(data => {
          const now = new Date();
          const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
          const entry = (data.entries || []).find(
            (e: any) => e.isManual && e.videoId === videoId && e.completedDate === today
          );
          setStandaloneWorkoutId(entry?.workoutId || null);
          setIsDone(!!entry);
          setShowMarkDone(true);
        })
        .catch(() => setShowMarkDone(false));
    };

    if (!workoutId) {
      loadStandaloneState();
      return;
    }

    fetch('/api/schedule')
      .then(res => res.json())
      .then(data => {
        // Either active plan (main or extra) can own this workout.
        const days = (data.schedules || []).flatMap((plan: any) => plan.schedule || []);
        const day = days.find((d: any) => d.workout?.id === workoutId);
        const videos = day?.workout?.videos || [];
        setSteps(videos.map((v: any) => ({
          id: v.id,
          title: stripVideoExt(v.filename),
          thumbnail: v.thumbnail || null,
          duration: typeof v.duration === 'number' ? v.duration : 0,
          done: Boolean(v.isCompleted),
        })));
        const currentVideo = videos.find((v: any) => v.id === videoId);
        if (currentVideo) {
          setStandalone(false);
          setIsDone(currentVideo.isCompleted);
          setShowMarkDone(true);
        } else {
          loadStandaloneState();
        }

        const currentIndex = videos.findIndex((v: any) => v.id === videoId);
        if (currentIndex !== -1) {
          setNextVideoId(currentIndex < videos.length - 1 ? videos[currentIndex + 1].id : null);
        }
      })
      .catch(() => loadStandaloneState());
  }, [videoId, workoutId]);

  // Resolve direct play vs. transcode before the <video> gets a src. Local files
  // only — an external video is played through its provider's embed.
  useEffect(() => {
    setPlayback(null);
    setPlaybackReady(false);
    if (!videoId || !isLoaded) return;
    if (isExternal) { setPlaybackReady(true); return; }
    let cancelled = false;
    // Waiting for the answer avoids handing <video> the direct URL first and
    // swapping it a moment later, which would start two loads of the same file.
    resolvePlayback(videoId).then(plan => {
      if (cancelled) return;
      setPlayback(plan);
      setPlaybackReady(true);
    });
    return () => { cancelled = true; };
  }, [videoId, isExternal, isLoaded]);

  // On the TV, moving between a workout's videos replaces the entry, so the
  // remote's Back leaves the player rather than stepping through every video.
  const partNav = isTv ? { replace: true } : undefined;
  const goToNext = () => {
    if (nextVideoId) navigate(`/player/${nextVideoId}/${workoutId}`, partNav);
  };

  // Looping is per-video: switching videos drops the count and any pending rest
  // rather than carrying a half-finished set onto the next exercise.
  useEffect(() => {
    setLoops(0);
    setPassesDone(0);
    passesDoneRef.current = 0;
    setRestLeft(null);
    restActionRef.current = null;
  }, [videoId]);

  // Bring the current video into view in the strip when you land on it or move on.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const now = strip?.querySelector<HTMLElement>('.pv-step.is-now');
    if (!strip || !now) return;
    const offset = now.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollTo({ left: Math.max(0, offset - 16) });
  }, [videoId, steps.length, isLoaded, playbackReady]);

  useEffect(() => {
    setUpNextHidden(false);
    setTime(0);
    setDuration(0);
    setPlaying(false);
    // The TV's error screen can move on to the next video, which must not
    // inherit this one's error.
    if (isTv) {
      setError(null);
      setErrorReason(null);
    }
  }, [videoId]);

  const restartVideo = () => {
    if (isExternal) {
      ytPlayerRef.current?.seekTo?.(0, true);
      ytPlayerRef.current?.playVideo?.();
    } else if (videoRef.current) {
      videoRef.current.currentTime = 0;
      // Autoplay can be refused; the user still has the native controls.
      videoRef.current.play().catch(() => {});
    }
  };

  /** Begin the rest period, or run `after` straight away when rest is off. */
  const startRest = (seconds: number, after: () => void) => {
    if (seconds <= 0) {
      after();
      return;
    }
    restActionRef.current = after;
    setRestLeft(seconds);
  };

  const endRest = () => {
    const run = restActionRef.current;
    restActionRef.current = null;
    setRestLeft(null);
    run?.();
  };

  // One timeout per remaining second. Re-running `endRest` from the effect body
  // is safe — it only navigates or restarts playback.
  useEffect(() => {
    if (restLeft === null) return;
    if (restLeft <= 0) {
      endRest();
      return;
    }
    const id = setTimeout(() => setRestLeft(s => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [restLeft]);

  const handleEnded = () => {
    // No loop, or the set is already finished and the user replayed by hand:
    // fall back to plain auto-advance rather than counting past the set.
    if (loops <= 0 || passesDoneRef.current >= loops) {
      goToNext();
      return;
    }
    const done = passesDoneRef.current + 1;
    passesDoneRef.current = done;
    setPassesDone(done);

    // More passes to go: rest, then play it again.
    if (done < loops) {
      startRest(restSeconds, restartVideo);
      return;
    }
    // Set finished. Rest before the next video too (its own, often longer,
    // duration), but don't leave the user staring at a countdown when there
    // is nothing to count down to.
    if (nextVideoId) startRest(nextRestSeconds, goToNext);
  };

  const toggleFullscreen = () => {
    if (fullscreenElement()) {
      exitFullscreen();
      return;
    }
    // The theater, not the <video>: a cross-origin iframe can't be fullscreened
    // directly, and going fullscreen on the video element alone would hide the
    // loop counter and rest countdown that sit over it. The video is passed as
    // the iPhone fallback, where the system player is the only fullscreen there is.
    enterFullscreen(theaterRef.current, videoRef.current);
  };

  // Whether we're filling the screen, so the button can say which way it goes.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Touch devices have no double-click, so without a real button there is no way
  // to reach fullscreen on a phone or tablet at all.
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);

  // Fullscreen is for watching, so the controls step aside a moment after the pointer
  // stops moving and come back on any movement, tap or key. They stay put while paused,
  // resting, with the loop panel open, or with the pointer over them. A YouTube video
  // is left alone: its frame swallows the pointer events we'd need to wake up again.
  const [idle, setIdle] = useState(false);
  // TV: the video starts filling the screen. Back steps down to the normal
  // player page (video, today's videos, details) instead of leaving; the
  // full-screen button goes back up. A second Back leaves the player.
  const [tvFull, setTvFull] = useState(true);
  const tvFullRef = useRef(true);
  tvFullRef.current = tvFull;
  const idleTimer = useRef<number | undefined>(undefined);
  const idleRef = useRef(false);
  const wasIdleOnPress = useRef(false);
  const overControls = useRef(false);
  const restingRef = useRef(false);
  restingRef.current = restLeft !== null;
  const showIdle = (value: boolean) => { idleRef.current = value; setIdle(value); };
  // TV mode is always full screen and has no pointer, so the controls hide
  // there too — for YouTube as well, whose frame no longer swallows anything.
  const playingRef = useRef(false);
  playingRef.current = playing;
  const wake = () => {
    showIdle(false);
    window.clearTimeout(idleTimer.current);
    if (isTv ? !tvFull : !isFullscreen || isExternal) return;
    idleTimer.current = window.setTimeout(() => {
      const paused = isExternal ? !playingRef.current : videoRef.current?.paused;
      if (overControls.current || restingRef.current || paused) return;
      if (theaterRef.current?.querySelector('.pv-loop-panel')) return;
      showIdle(true);
    }, 2800);
  };
  // Re-arm (or clear) when going in and out of fullscreen and when play state changes.
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, isExternal, playing, restLeft, tvFull]);
  useEffect(() => {
    const onKey = () => wake();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, isExternal]);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(fullscreenElement()));
    sync();
    setFullscreenAvailable(canFullscreen(theaterRef.current, videoRef.current));
    return onFullscreenChange(videoRef.current, sync);
  }, [videoId, isLoaded, playbackReady, isExternal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't steal Space/arrows from the page's own controls — typing a loop
      // count would otherwise pause and seek the video.
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [data-player-ui]')) return;

      // Same shortcuts either way; the two players just expose different APIs.
      const player = isExternal ? ytPlayerRef.current : videoRef.current;
      if (!player) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (isExternal) {
          // 1 === YT.PlayerState.PLAYING; read numerically so this doesn't
          // depend on the YT global being loaded.
          if (player.getPlayerState?.() === 1) player.pauseVideo();
          else player.playVideo();
        } else {
          if (player.paused) player.play();
          else player.pause();
        }
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const delta = e.code === 'ArrowRight' ? 10 : -10;
        if (isExternal) {
          player.seekTo?.(Math.max(0, (player.getCurrentTime?.() || 0) + delta), true);
        } else {
          player.currentTime += delta;
        }
      } else if (e.code === 'KeyF') {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExternal]);

  // --- TV mode -------------------------------------------------------------
  // The remote's media buttons, read through a ref so they always act on the
  // current video and workout.
  const tvActions = useRef({ toggle: () => {}, play: () => {}, pause: () => {}, seekBy: (_s: number) => {}, next: () => {}, prev: () => {} });
  useEffect(() => {
    if (!isTv) return;
    const onKey = (e: KeyboardEvent) => {
      const a = tvActions.current;
      const act: Record<string, () => void> = {
        MediaPlayPause: a.toggle,
        MediaPlay: a.play,
        MediaPause: a.pause,
        MediaFastForward: () => a.seekBy(10),
        MediaRewind: () => a.seekBy(-10),
        MediaTrackNext: a.next,
        MediaTrackPrevious: a.prev,
      };
      if (act[e.key]) { e.preventDefault(); act[e.key](); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // With the controls hidden, the first press only brings them back — nobody
  // wants OK to pause a video they can't see the controls of.
  useEffect(() => {
    if (!isTv) return;
    return addTvKeyInterceptor(() => {
      if (!idleRef.current) return false;
      wake();
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExternal]);

  // The TV app keeps the screen awake while a workout runs, not while paused.
  useEffect(() => {
    tvKeepScreenOn(playing || restLeft !== null);
  }, [playing, restLeft]);
  useEffect(() => () => tvKeepScreenOn(false), []);
  useEffect(() => {
    tvVideoOpen(true);
    return () => tvVideoOpen(false);
  }, []);

  // Full screen on the TV: the page drops the nav and fills the screen with the
  // video (tv.css). Out of full screen it is the ordinary player page.
  useEffect(() => {
    if (!isTv || !tvFull) return;
    document.documentElement.classList.add('tv-player');
    return () => document.documentElement.classList.remove('tv-player');
  }, [tvFull]);

  // On the TV a video only ever plays full screen: Fire TV can't show the
  // picture in the small player (it draws video behind the page, and only the
  // full-screen hole lines up). So stepping down pauses it, and anything that
  // starts playback again (Play, a video picked from the strip, the end of a
  // rest) goes back up.
  const tvMinimizedAt = useRef(0);
  useEffect(() => {
    if (!isTv) return;
    return addTvBackHandler(() => {
      if (!tvFullRef.current) return false;
      tvMinimizedAt.current = Date.now();
      if (ytPlayerRef.current) ytPlayerRef.current.pauseVideo?.();
      else videoRef.current?.pause();
      setPlaying(false);
      setTvFull(false);
      return true;
    });
  }, []);
  useEffect(() => {
    // The grace period covers YouTube, which reports "playing" for a moment
    // after being paused.
    if (isTv && playing && !tvFull && Date.now() - tvMinimizedAt.current > 1500) setTvFull(true);
  }, [playing, tvFull]);

  // Stepping out of full screen lands on the current video in today's strip,
  // ready to pick another; with no strip, on the button to go back up.
  // Going back up to full screen puts focus on Play/Pause (the button pressed
  // to get there is gone).
  const tvFullMounted = useRef(false);
  useEffect(() => {
    if (!isTv) return;
    if (!tvFullMounted.current) { tvFullMounted.current = true; return; }
    if (tvFull) requestAnimationFrame(() => document.querySelector<HTMLElement>('.pv-theater [data-tv-default]')?.focus({ preventScroll: true }));
  }, [tvFull]);
  useEffect(() => {
    if (!isTv || tvFull) return;
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.pv-step.is-now') || document.querySelector<HTMLElement>('.pv-tv-full');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center' });
    });
  }, [tvFull]);

  // YouTube reports nothing by itself; poll it so our controls can draw it.
  useEffect(() => {
    if (!isTv || !isExternal) return;
    const id = window.setInterval(() => {
      const yt = ytPlayerRef.current;
      if (!yt?.getCurrentTime) return;
      setTime(yt.getCurrentTime() || 0);
      setDuration(yt.getDuration?.() || 0);
      setPlaying(yt.getPlayerState?.() === 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [isExternal, videoId]);

  // How many times through the video the user actually got, counting the pass
  // in progress (but not one that hasn't started — during rest the pass that
  // just finished is the last one to count). Logged so a set reads as "10×".
  const loggedLoops = loops > 0 ? Math.min(passesDone + (restLeft === null ? 1 : 0), loops) : 0;

  const handleToggleDone = async () => {
    if (!videoId || isMarking) return;
    setIsMarking(true);
    try {
      if (!standalone && workoutId) {
        // Part of the active plan: toggle plan completion (also updates the log).
        const res = await fetch('/api/schedule/toggle-done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workoutId, videoId, loopCount: loggedLoops })
        });
        const data = await res.json();
        if (res.ok) {
          setIsDone(data.completed);
          setSteps(list => list.map(s => (s.id === videoId ? { ...s, done: data.completed } : s)));
        }
      } else if (isDone && standaloneWorkoutId) {
        // Standalone un-mark: remove the manual log entry created earlier.
        const res = await fetch(`/api/profile/history/${encodeURIComponent(standaloneWorkoutId)}`, { method: 'DELETE' });
        if (res.ok) {
          setIsDone(false);
          setStandaloneWorkoutId(null);
        }
      } else {
        // Standalone mark: log this video to the workout log for today.
        const now = new Date();
        const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
        const res = await fetch('/api/profile/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedDate: today, videoIds: [videoId], loopCount: loggedLoops })
        });
        const data = await res.json();
        if (res.ok) {
          setIsDone(true);
          setStandaloneWorkoutId(data.workoutIds?.[0] || null);
        }
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    } finally {
      setIsMarking(false);
    }
  };

  if (error) {
    return (
      <div className="pv-page pv-notice">
        <h2>{t('player.error_title')}</h2>
        <p>{error}</p>
        {isTv ? (
          // A workout shouldn't dead-end on one video that won't play here.
          <div className="pv-notice-actions">
            {errorReason === 'embed_blocked' && externalId && canOpenYouTubeApp() && (
              <button type="button" onClick={() => openYouTubeApp(externalId)} className="rx-btn rx-btn--primary">{t('player.tv_open_youtube')}</button>
            )}
            {nextVideoId && (
              <button type="button" onClick={goToNext} className="rx-btn" data-tv-default="">{t('player.tv_skip_video')}</button>
            )}
            <button type="button" onClick={() => navigate(-1)} className="rx-btn">{t('player.back')}</button>
          </div>
        ) : (
          <button onClick={() => navigate(-1)} className="rx-btn">{t('player.back')}</button>
        )}
      </div>
    );
  }

  if (!isLoaded || !playbackReady) {
    return <div className="pv-page pv-notice">{t('player.loading')}</div>;
  }

  // The server's answer wins; the plain file URL is the fallback if it never
  // arrived, which is exactly the behaviour the app had before.
  const videoUrl = isExternal ? '' : (playback?.url || videoStreamUrl(videoPath));
  const isYouTube = isExternal;
  const partIndex = steps.findIndex(s => s.id === videoId);
  const nextStep = partIndex >= 0 && partIndex < steps.length - 1 ? steps[partIndex + 1] : null;
  const inWorkout = partIndex >= 0 && !standalone;

  // The YouTube branches only run on the TV, the one place our controls sit on
  // top of a YouTube video.
  const yt = isExternal ? ytPlayerRef.current : null;
  const togglePlay = () => {
    if (yt) {
      if (restLeft !== null) return;
      if (yt.getPlayerState?.() === 1) yt.pauseVideo(); else yt.playVideo();
      return;
    }
    const el = videoRef.current;
    if (!el || restLeft !== null) return;
    if (el.paused || el.ended) el.play().catch(() => {});
    else el.pause();
  };
  const seekTo = (seconds: number) => {
    if (yt) {
      if (!duration) return;
      const to = Math.max(0, Math.min(duration, seconds));
      yt.seekTo?.(to, true);
      setTime(to);
      return;
    }
    const el = videoRef.current;
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(duration, seconds));
    setTime(el.currentTime);
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
    yt?.setPlaybackRate?.(next);
  };
  const toggleMute = () => {
    // Parked at zero, the speaker means "let me hear it", not "mute".
    if (volume === 0) {
      changeVolume(0.5);
      setMuted(false);
      if (videoRef.current) videoRef.current.muted = false;
      return;
    }
    setMuted(m => !m);
    if (videoRef.current) videoRef.current.muted = !muted;
  };
  const changeVolume = (value: number) => {
    const v = Math.min(1, Math.max(0, value));
    setVolumeState(v);
    if (videoRef.current) videoRef.current.volume = v;
    // Dragging the slider up is asking to hear it.
    if (v > 0 && muted) {
      setMuted(false);
      if (videoRef.current) videoRef.current.muted = false;
    }
    try { localStorage.setItem('playerVolume', String(v)); } catch { /* not remembered */ }
  };
  const silent = muted || volume === 0;
  const onScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const clock = (s: number) => {
    const total = Math.max(0, Math.floor(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const prevStep = inWorkout && partIndex > 0 ? steps[partIndex - 1] : null;
  const goToStep = (id: string) => navigate(`/player/${id}/${workoutId}`, partNav);
  tvActions.current = {
    toggle: togglePlay,
    play: () => { if (yt) yt.playVideo?.(); else videoRef.current?.play().catch(() => {}); },
    pause: () => { if (yt) yt.pauseVideo?.(); else videoRef.current?.pause(); },
    seekBy: s => seekTo(time + s),
    next: () => { if (nextStep) goToStep(nextStep.id); },
    prev: () => { if (prevStep) goToStep(prevStep.id); },
  };
  // Our controls: always for a local file; for YouTube only on the TV, where
  // YouTube's own controls can't be reached with a remote.
  const ownControls = !isYouTube || isTv;
  const showUpNext = Boolean(nextStep) && !upNextHidden && restLeft === null && (loops === 0 || passesDone >= loops) && (isDone || (loops === 0 && duration > 0 && duration - time <= 15));

  // The bar under the video: today's tally and the one button that moves you on.
  const doneCount = steps.filter(s => s.done).length;
  const secondsLeft = steps.reduce((sum, s) => sum + (s.done ? 0 : s.id === videoId ? Math.max(0, (s.duration || duration) - time) : s.duration), 0);
  const lastPart = partIndex === steps.length - 1;
  // One button, and it only ever toggles this video's done state — moving on is
  // the strip's job. Done reads green, and says what a click will undo on hover.
  const primary = showMarkDone
    ? isDone
      ? { label: t(standalone ? 'player.logged_done' : 'player.part_done'), tone: 'done' }
      : { label: t(standalone ? 'player.mark_done' : lastPart && steps.length > 1 ? 'player.mark_workout_done' : 'player.mark_part_done'), tone: 'soft' }
    : null;
  const primaryButton = primary && (
    <button type="button" className={`pv-primary pv-primary--${primary.tone}`} onClick={handleToggleDone} disabled={isMarking}>
      <Check size={16} />
      <span className="pv-lbl">{primary.label}</span>
      {isDone && <span className="pv-lbl-undo">{t('player.undo_done')}</span>}
    </button>
  );

  const tags = video ? tagsFor(video) : [];
  const title = video ? stripVideoExt(video.filename) : filename;
  const description = video?.description || '';

  const meta = (
    <span className="pv-meta">
      {inWorkout && <span>{t('player.part_of', { current: partIndex + 1, total: steps.length })}</span>}
      {inWorkout && <span className="pv-dot" />}
      {isExternal ? (
        <span className="pv-meta-src"><YouTubeGlyph size={12} />YouTube</span>
      ) : playback ? (
        <span
          className="pv-meta-src"
          title={t(`player.playback_hint_${playback.reason}`, {
            container: (playback.container || '?').toUpperCase(),
            video: playback.videoCodec || '?',
            audio: playback.audioCodec || t('player.playback_no_audio'),
          })}
        >
          <HardDrive size={12} />{playback.mode === 'direct' ? t('player.playback_direct') : t('player.playback_converting')}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="pv-page">
      <div className="pv-stage">
        <div
          className={`pv-theater${isYouTube ? ' is-embed' : ''}${idle ? ' is-idle' : ''}`}
          ref={theaterRef}
          onDoubleClick={toggleFullscreen}
          onPointerDownCapture={() => { wasIdleOnPress.current = idleRef.current; }}
          onPointerMove={wake}
          onPointerDown={wake}
        >
          {isExternal ? (
            externalId ? (
              <YouTubeEmbed
                externalId={externalId}
                onEnded={handleEnded}
                onReady={player => { ytPlayerRef.current = player; }}
                onError={reason => { setErrorReason(reason); setError(t(`player.youtube_error_${reason}`)); }}
                ownControls={isTv}
              />
            ) : (
              <div className="player-youtube-error">{t('player.youtube_error_unavailable')}</div>
            )
          ) : (
            <video
              ref={videoRef}
              src={videoUrl}
              autoPlay
              muted={muted}
              /* Without this an iPhone hijacks playback into the system player the
                 moment it starts, so the theater and its overlays never appear. */
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={e => {
                setDuration(e.currentTarget.duration || 0);
                // A new source resets the speed, so the chosen one is put back.
                e.currentTarget.playbackRate = rate;
                e.currentTarget.volume = volume;
              }}
              onEnded={handleEnded}
              onError={() => setError('Could not play this video. The file may be missing or use an unsupported format.')}
            />
          )}
          {ownControls && (
            <div
              className="pv-hit"
              onClick={() => {
                // A tap that only woke the controls shouldn't also pause the video.
                if (wasIdleOnPress.current) { wasIdleOnPress.current = false; return; }
                togglePlay();
              }}
            />
          )}

          <div className="pv-top" onPointerEnter={() => { overControls.current = true; }} onPointerLeave={() => { overControls.current = false; }}>
            <button type="button" className="pv-round" onClick={() => navigate(-1)} aria-label={t('player.close')} title={t('player.close')}>
              <X size={18} />
            </button>
            <div className="pv-top-text">
              <div className="pv-top-title">{title}</div>
              {meta}
            </div>
            <LoopControl
              loops={loops}
              restSeconds={restSeconds}
              nextRestSeconds={nextRestSeconds}
              currentPass={Math.min(passesDone + 1, loops || 1)}
              restLeft={restLeft}
              onApply={(nextLoops, nextRest, nextVideoRest) => {
                // Starting a fresh set counts the pass already on screen as #1;
                // only adjusting an existing one keeps the tally.
                if (loops === 0) {
                  setPassesDone(0);
                  passesDoneRef.current = 0;
                }
                setLoops(nextLoops);
                setRestSeconds(nextRest);
                setNextRestSeconds(nextVideoRest);
                // "Start loop" starts the video going, as the handoff has it.
                if (!isExternal && videoRef.current?.paused) videoRef.current.play().catch(() => {});
              }}
              onClear={() => {
                setLoops(0);
                setPassesDone(0);
                passesDoneRef.current = 0;
                restActionRef.current = null;
                setRestLeft(null);
              }}
            />
          </div>

          {/* TV, out of full screen: a still instead of the (paused, unshowable) video. */}
          {isTv && !tvFull && (
            <div className="pv-tv-still">
              {video?.thumbnail_path ? <img src={`/thumbnails/${video.thumbnail_path}`} alt="" /> : null}
            </div>
          )}

          {ownControls && !playing && restLeft === null && !showUpNext && (
            <button type="button" className="pv-bigplay" onClick={togglePlay} aria-label={t('player.play')}>
              <Play size={32} />
            </button>
          )}

          {restLeft !== null && (
            <div className="pv-rest" data-player-ui>
              {/* Announced once when the rest starts. The visible clock is hidden
                  from assistive tech so it isn't read out every second. */}
              <span className="sr-only" role="status">
                {passesDone < loops
                  ? t('player.rest_announce_loop', { current: passesDone + 1, total: loops })
                  : t('player.rest_announce_video')}
              </span>
              <span aria-hidden="true" className="pv-rest-label">{t('player.rest_heading')}</span>
              <span aria-hidden="true" className="pv-rest-time">{formatRest(restLeft)}</span>
              <span aria-hidden="true" className="pv-rest-next">
                {passesDone < loops
                  ? t('player.rest_next_loop', { current: passesDone + 1, total: loops })
                  : t('player.rest_next_video')}
              </span>
              <button type="button" className="pv-rest-skip" onClick={endRest} ref={focusRestSkipOnTv}>
                <SkipForward size={15} />{t('player.rest_skip')}
              </button>
            </div>
          )}

          {showUpNext && nextStep && (
            <div className={`pv-upnext${isYouTube ? ' is-embed' : ''}`} data-player-ui>
              {nextStep.thumbnail ? <img src={`/thumbnails/${nextStep.thumbnail}`} alt="" /> : <span className="pv-upnext-blank" />}
              <div>
                <div className="pv-upnext-eyebrow">{t('player.up_next', { n: partIndex + 2 })}</div>
                <div className="pv-upnext-title">{nextStep.title}</div>
              </div>
              <button type="button" onClick={goToNext} aria-label={t('player.play_part', { n: partIndex + 2 })}><Play size={18} /></button>
              <button type="button" className="pv-upnext-x" onClick={() => setUpNextHidden(true)} aria-label={t('player.dismiss')}><X size={14} /></button>
            </div>
          )}

          {ownControls && (
            <div className="pv-bar" data-player-ui onPointerEnter={() => { overControls.current = true; }} onPointerLeave={() => { overControls.current = false; }}>
              <div
                className="pv-scrub"
                role="slider"
                tabIndex={0}
                aria-label={t('player.seek')}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(time)}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onScrub(e); }}
                onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(e); }}
                onKeyDown={e => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(time + 5); }
                  if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(time - 5); }
                }}
              >
                <div className="pv-scrub-track">
                  <div className="pv-scrub-fill" style={{ width: `${pct}%` }} />
                  <div className="pv-scrub-knob" style={{ left: `${pct}%` }} />
                </div>
              </div>
              <div className="pv-ctrls">
                <button type="button" onClick={togglePlay} aria-label={t(playing ? 'player.pause' : 'player.play')} {...(isTv ? { 'data-tv-default': '' } : {})}>
                  {playing ? <Pause size={22} /> : <Play size={22} />}
                </button>
                <button type="button" onClick={() => seekTo(time - 10)} aria-label={t('player.back_10')}><RotateCcw size={18} /></button>
                <button type="button" onClick={() => seekTo(time + 10)} aria-label={t('player.forward_10')}><RotateCw size={18} /></button>
                {/* On the TV the workout's videos are a button press away, not a scroll. */}
                {isTv && prevStep && (
                  <button type="button" onClick={() => goToStep(prevStep.id)} aria-label={t('player.tv_previous_part', { n: partIndex })}><SkipBack size={18} /></button>
                )}
                {isTv && nextStep && (
                  <button type="button" onClick={() => goToStep(nextStep.id)} aria-label={t('player.tv_next_part', { n: partIndex + 2 })}><SkipForward size={18} /></button>
                )}
                <span className="pv-clock">{clock(time)} / {clock(duration)}</span>
                <span className="pv-grow" />
                {/* On the TV, finishing a part is a button on the controls, not a scroll away. */}
                {isTv && primaryButton}
                <button type="button" className="pv-speed" onClick={cycleSpeed} aria-label={t('player.speed')}>{rate}×</button>
                {!isTv && <div className="pv-vol pv-desk">
                  <button type="button" onClick={toggleMute} aria-label={t(silent ? 'player.unmute' : 'player.mute')}>
                    {silent ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    className="pv-vol-slider"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    aria-label={t('player.volume')}
                    style={{ ['--pv-fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
                    onChange={e => changeVolume(Number(e.target.value))}
                  />
                </div>}
                {isTv && !tvFull && (
                  <button type="button" className="pv-tv-full" onClick={() => setTvFull(true)} aria-label={t('player.fullscreen_enter')}>
                    <Maximize size={18} />
                  </button>
                )}
                {fullscreenAvailable && !isTv && (
                  <button type="button" onClick={toggleFullscreen} aria-label={t(isFullscreen ? 'player.fullscreen_exit' : 'player.fullscreen_enter')}>
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <h1 className="pv-mobile-title">{title}</h1>

        {(steps.length > 0 || primary) && (
          <section className="pv-today rx-card">
            <div className="pv-today-head">
              <div>
                <div className="pv-eyebrow">{t('player.today')}</div>
                {steps.length > 0 && (
                  <div className="pv-today-sub">
                    {t('player.today_summary', { count: steps.length, done: doneCount, left: clock(secondsLeft) })}
                  </div>
                )}
              </div>
              <div className="pv-today-cta pv-desk-only">{primaryButton}</div>
            </div>
            {steps.length > 0 && (
              <div className="pv-strip" ref={stripRef}>
                {steps.map((s, i) => {
                  const current = s.id === videoId;
                  return (
                    <button key={s.id} type="button" className={`pv-step${current ? ' is-now' : ''}${s.done && !current ? ' is-done' : ''}`} onClick={() => { if (!current) goToStep(s.id); }} aria-current={current ? 'true' : undefined}>
                      <span className="pv-step-img">
                        {s.thumbnail ? <img src={`/thumbnails/${s.thumbnail}`} alt="" loading="lazy" /> : null}
                        <span className={`pv-step-badge${s.done ? ' is-done' : current ? ' is-now' : ''}`}>
                          {s.done && <Check size={12} />}
                          {current ? t('player.now') : i + 1}
                        </span>
                        {!current && <span className="pv-step-play" aria-hidden="true"><Play size={16} /></span>}
                        {formatDuration(s.duration) && <span className="rx-dur pv-step-dur">{formatDuration(s.duration)}</span>}
                      </span>
                      <span className="pv-step-title">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="pv-today-cta pv-mob-only">{primaryButton}</div>
          </section>
        )}

        <div className={`pv-info${tags.length === 0 ? ' pv-info--single' : ''}`}>
          <section className="rx-card pv-card pv-desc">
            <div className="pv-card-head">
              <div className="pv-eyebrow">{t('player.description_heading')}</div>
              {video && <button type="button" className="pv-link" onClick={() => setEditing(true)}>{t('player.edit_details')}</button>}
            </div>
            <div className="pv-desc-text">
              {description.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
              ) : (
                <span className="pv-muted">{labels.noDescription}</span>
              )}
            </div>
          </section>
          {tags.length > 0 && (
            <section className="rx-card pv-card pv-tagcard">
              <div className="pv-eyebrow">{t('player.tags_heading')}</div>
              <div className="pv-tags">
                {tags.map(tag => <span key={tag.key} className={`rx-tag rx-tag--${tag.category}`}>{tag.label}</span>)}
              </div>
            </section>
          )}
        </div>
      </div>

      {editing && video && (
        <Modal width={780} onClose={() => setEditing(false)} label={t('editor.title')}>
          <VideoEditForm
            video={video}
            onCancel={() => setEditing(false)}
            onSaved={updated => { setVideo(updated); setEditing(false); }}
          />
        </Modal>
      )}
    </div>
  );
}
