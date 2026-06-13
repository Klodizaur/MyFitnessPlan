import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EquipmentIcon, getEquipmentItem } from '../lib/equipment';

export default function Player() {
  const { videoId, workoutId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [filename, setFilename] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [description, setDescription] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [showMarkDone, setShowMarkDone] = useState(false);
  const [nextVideoId, setNextVideoId] = useState<string | null>(null);
  const [prevVideoId, setPrevVideoId] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/library/videos')
      .then(res => res.json())
      .then(data => {
        const vid = data.find((v: any) => v.id === videoId);
        if (vid) {
          setFilename(vid.filename);
          setVideoPath(vid.relative_path);
          setDescription(vid.description || '');
          setEquipment(vid.equipment || []);
        } else {
          setError('Video not found in library');
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load video details');
      });

    fetch('http://localhost:3000/api/schedule')
      .then(res => res.json())
      .then(data => {
        const schedule = data.schedule || [];
        const day = schedule.find((d: any) => d.workout?.id === workoutId);
        if (day?.workout) {
          const videos = day.workout.videos || [];
          const currentVideo = videos.find((v: any) => v.id === videoId);
          if (currentVideo) {
            setIsDone(currentVideo.isCompleted);
            setShowMarkDone(true);
          } else {
            setIsDone(false);
            setShowMarkDone(false);
          }

          const currentIndex = videos.findIndex((v: any) => v.id === videoId);
          if (currentIndex !== -1) {
            setNextVideoId(currentIndex < videos.length - 1 ? videos[currentIndex + 1].id : null);
            setPrevVideoId(currentIndex > 0 ? videos[currentIndex - 1].id : null);
          }
        }
      });
  }, [videoId, workoutId]);

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (videoRef.current.paused) videoRef.current.play();
        else videoRef.current.pause();
      } else if (e.code === 'ArrowRight') {
        videoRef.current.currentTime += 10;
      } else if (e.code === 'ArrowLeft') {
        videoRef.current.currentTime -= 10;
      } else if (e.code === 'KeyF') {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleToggleDone = async () => {
    if (!workoutId || !videoId || isMarking) return;
    setIsMarking(true);
    try {
      const res = await fetch('http://localhost:3000/api/schedule/toggle-done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId, videoId })
      });
      const data = await res.json();
      if (res.ok) setIsDone(data.completed);
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

  if (!videoPath) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  const videoUrl = `http://localhost:3000/videos/${videoPath.split('/').map(encodeURIComponent).join('/')}`;
  const hasMeta = Boolean(description.trim()) || equipment.length > 0;

  return (
    <div className="player-wrap">
      <div className="player-theater" onDoubleClick={toggleFullscreen}>
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
                {isDone ? '✓ This Part Done' : 'Mark Part Done'}
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

        <video
          ref={videoRef}
          src={videoUrl}
          controls
          autoPlay
          onEnded={() => nextVideoId && navigate(`/player/${nextVideoId}/${workoutId}`)}
        />

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
        <div className="glass-card player-details">
          {description.trim() && (
            <p className="player-details-text">{description}</p>
          )}
          {equipment.length > 0 && (
            <div className="player-details-equipment">
              {equipment.map(id => (
                <span key={id} className="player-equipment-tag" title={getEquipmentItem(id)?.label}>
                  <EquipmentIcon id={id} size={16} />
                  {getEquipmentItem(id)?.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
