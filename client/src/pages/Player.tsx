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
        const schedule = data.schedule || [];
        const day = schedule.find((d: any) => d.workout?.id === workoutId);
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

  const handleToggleDone = async () => {
    if (!videoId || isMarking) return;
    setIsMarking(true);
    try {
      if (!standalone && workoutId) {
        // Part of the active plan: toggle plan completion (also updates the log).
        const res = await fetch('/api/schedule/toggle-done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workoutId, videoId })
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
          body: JSON.stringify({ completedDate: today, videoIds: [videoId] })
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
  const hasMeta = Boolean(description.trim()) || equipment.length > 0 || trainingType.length > 0 || bodyParts.length > 0 || Boolean(intensity);

  const goToNext = () => {
    if (nextVideoId) navigate(`/player/${nextVideoId}/${workoutId}`);
  };

  return (
    <div className="player-wrap">
      <div className="player-theater" ref={theaterRef} onDoubleClick={toggleFullscreen}>
        {/* Header overlay — title + actions only */}
        <div className="player-theater-header">
          <h2>{filename}</h2>
          <div className="player-theater-actions">
            {showMarkDone && (
              <button
                onClick={handleToggleDone}
                disabled={isMarking}
                style={{
                  background: isDone ? '#10b981' : 'rgba(255,255,255,0.15)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '10px 20px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  fontWeight: 600,
                }}
              >
                {standalone
                  ? (isDone ? '✓ Logged as Done' : 'Mark as Done')
                  : (isDone ? '✓ This Part Done' : 'Mark Part Done')}
              </button>
            )}
            <button
              onClick={() => navigate(-1)}
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.2)',
                padding: '10px 20px',
                borderRadius: '10px',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
            >
              Close
            </button>
          </div>
        </div>

        {isExternal ? (
          externalId ? (
            <YouTubeEmbed
              externalId={externalId}
              onEnded={goToNext}
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
            onEnded={goToNext}
            onError={() => setError('Could not play this video. The file may be missing or use an unsupported format.')}
          />
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
        <div className="glass-card player-details player-details-grid">
          {/* Left column: description (~70%) */}
          <div className="player-details-text">
            {description.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            ) : (
              <span style={{ color: 'var(--text-secondary)' }}>{labels.noDescription}</span>
            )}
          </div>

          {/* Right column: tags (~30%) */}
          {(equipment.length > 0 || trainingType.length > 0 || bodyParts.length > 0 || Boolean(intensity)) && (
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
          )}
        </div>
      )}
    </div>
  );
}
