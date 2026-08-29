import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { EquipmentIcon } from '../lib/equipment';
import { TrainingTypeIcon, BodyPartIcon, IntensityIcon } from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';
import { videoStreamUrl } from '../lib/paths';
import YouTubeEmbed from '../components/YouTubeEmbed';
import LoopControl, { formatRest } from '../components/LoopControl';

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
  const [description, setDescription] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingType, setTrainingType] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
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
  const [prevVideoId, setPrevVideoId] = useState<string | null>(null);
  const labels = useMetaLabels();

  // --- Loop + rest ---------------------------------------------------------
  // `loops` is the total number of passes the user asked for, counting the one
  // already playing when they set it up: "10 times" means 10 plays, not 10
  // repeats on top of the first. `passesDone` counts finished passes, so the
  // pass on screen is always passesDone + 1.
  const [loops, setLoops] = useState(0);
  const [restSeconds, setRestSeconds] = useState(60);
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
          setDescription(vid.description || '');
          setEquipment(vid.equipment || []);
          setTrainingType(vid.training_type || []);
          setBodyParts(vid.body_parts || []);
          setIntensity(vid.intensity || '');
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
          setPrevVideoId(currentIndex > 0 ? videos[currentIndex - 1].id : null);
        }
      })
      .catch(() => loadStandaloneState());
  }, [videoId, workoutId]);

  const goToNext = () => {
    if (nextVideoId) navigate(`/player/${nextVideoId}/${workoutId}`);
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
  const startRest = (after: () => void) => {
    if (restSeconds <= 0) {
      after();
      return;
    }
    restActionRef.current = after;
    setRestLeft(restSeconds);
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
      startRest(restartVideo);
      return;
    }
    // Set finished. Rest before the next video too, but don't leave the user
    // staring at a countdown when there is nothing to count down to.
    if (nextVideoId) startRest(goToNext);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    // A cross-origin iframe can't be fullscreened directly, so external videos
    // fullscreen the theater wrapper instead.
    const target = isExternal ? theaterRef.current : videoRef.current;
    target?.requestFullscreen();
  };

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
        if (res.ok) setIsDone(data.completed);
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
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => navigate(-1)} className="btn">Back</button>
      </div>
    );
  }

  if (!isLoaded) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  const videoUrl = isExternal ? '' : videoStreamUrl(videoPath);
  const hasTags = equipment.length > 0 || trainingType.length > 0 || bodyParts.length > 0 || Boolean(intensity);
  const hasMeta = Boolean(description.trim()) || hasTags;

  return (
    <div className="player-wrap">
      <div className="player-theater" ref={theaterRef} onDoubleClick={toggleFullscreen}>
        {/* Header overlay — title + actions only */}
        <div className="player-theater-header">
          <h2>{filename}</h2>
          <div className="player-theater-actions">
            <LoopControl
              loops={loops}
              restSeconds={restSeconds}
              currentPass={Math.min(passesDone + 1, loops || 1)}
              restLeft={restLeft}
              onApply={(nextLoops, nextRest) => {
                // Starting a fresh set counts the pass already on screen as #1;
                // only adjusting an existing one keeps the tally.
                if (loops === 0) {
                  setPassesDone(0);
                  passesDoneRef.current = 0;
                }
                setLoops(nextLoops);
                setRestSeconds(nextRest);
              }}
              onClear={() => {
                setLoops(0);
                setPassesDone(0);
                passesDoneRef.current = 0;
                restActionRef.current = null;
                setRestLeft(null);
              }}
            />
            {showMarkDone && (
              <button
                onClick={handleToggleDone}
                disabled={isMarking}
                className="player-theater-btn"
                style={isDone ? { background: '#10b981', borderColor: 'transparent' } : undefined}
              >
                {standalone
                  ? (isDone ? '✓ Logged as Done' : 'Mark as Done')
                  : (isDone ? '✓ This Part Done' : 'Mark Part Done')}
              </button>
            )}
            <button onClick={() => navigate(-1)} className="player-theater-btn">
              Close
            </button>
          </div>
        </div>

        {isExternal ? (
          externalId ? (
            <YouTubeEmbed
              externalId={externalId}
              onEnded={handleEnded}
              onReady={player => { ytPlayerRef.current = player; }}
              onError={reason => setError(t(`player.youtube_error_${reason}`))}
            />
          ) : (
            <div className="player-youtube-error">{t('player.youtube_error_unavailable')}</div>
          )
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            onEnded={handleEnded}
            onError={() => setError('Could not play this video. The file may be missing or use an unsupported format.')}
          />
        )}

        {/* Rest between passes. Sits under the header (z-index 20) so the loop
            and close buttons stay reachable while the clock runs. */}
        {restLeft !== null && (
          <div className="player-rest" data-player-ui>
            {/* Announced once when the rest starts. The visible clock is hidden
                from assistive tech so it isn't read out every second. */}
            <span className="sr-only" role="status">
              {passesDone < loops
                ? t('player.rest_announce_loop', { current: passesDone + 1, total: loops })
                : t('player.rest_announce_video')}
            </span>
            <span aria-hidden="true" className="player-rest-label">{t('player.rest_heading')}</span>
            <span aria-hidden="true" className="player-rest-time">{formatRest(restLeft)}</span>
            <span aria-hidden="true" className="player-rest-next">
              {passesDone < loops
                ? t('player.rest_next_loop', { current: passesDone + 1, total: loops })
                : t('player.rest_next_video')}
            </span>
            <button type="button" className="player-rest-skip" onClick={endRest}>
              {t('player.rest_skip')}
            </button>
          </div>
        )}

        {/* Floating prev/next */}
        <div className="player-theater-nav">
          {prevVideoId && (
            <button
              onClick={() => navigate(`/player/${prevVideoId}/${workoutId}`)}
              className="player-nav-btn"
              style={{
                background: 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(12px)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.2)',
                padding: '12px 24px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              }}
            >
              ← Previous
            </button>
          )}

          {nextVideoId && (
            <button
              onClick={() => navigate(`/player/${nextVideoId}/${workoutId}`)}
              className="player-nav-btn"
              style={{
                background: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '800',
                boxShadow: '0 8px 32px rgba(59, 130, 246, 0.3)',
              }}
            >
              Next Video →
            </button>
          )}
        </div>
      </div>

      {hasMeta && (
        /* Two panels rather than two columns of one: the description and the
           tags are different kinds of thing, and a shared card ran them
           together. The description takes the larger share. */
        <div className={`player-details-grid${hasTags ? '' : ' single'}`}>
          <div className="glass-card player-details">
            <h3 className="player-details-heading">{t('player.description_heading')}</h3>
            <div className="player-details-text">
              {description.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>{labels.noDescription}</span>
              )}
            </div>
          </div>

          {hasTags && (
            <div className="glass-card player-details">
            <h3 className="player-details-heading">{t('player.tags_heading')}</h3>
            <div className="player-details-tags" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Equipment */}
              {equipment.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>{labels.sections.equipment}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {Array.from(new Set(equipment)).map(id => (
                      <div key={id} className="player-meta-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.9rem' }} title={labels.equipment(id)}>
                        <EquipmentIcon id={id} size={16} />
                        <span style={{ color: 'var(--text-primary)' }}>{labels.equipment(id)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Training type */}
              {trainingType.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>{labels.sections.trainingType}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Array.from(new Set(trainingType)).map(tt => (
                      <div key={tt} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.9rem', fontWeight: 700 }}>
                        <TrainingTypeIcon type={tt} />
                        <span>{labels.trainingType(tt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body parts */}
              {bodyParts.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>{labels.sections.bodyParts}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Array.from(new Set(bodyParts)).map(bp => (
                      <div key={bp} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.9rem' }} title={labels.bodyPart(bp)}>
                        <BodyPartIcon part={bp} />
                        <span>{labels.bodyPart(bp)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Intensity */}
              {intensity && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>{labels.sections.intensity}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--accent-soft)', border: '1px solid var(--accent-color)', fontSize: '0.9rem', color: 'var(--accent-color)', fontWeight: 700 }}>
                      <IntensityIcon level={intensity} />
                      <span style={{ textTransform: 'capitalize' }}>{labels.intensity(intensity)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
