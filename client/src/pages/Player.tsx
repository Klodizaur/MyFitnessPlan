import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function Player() {
  const { videoId, workoutId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [filename, setFilename] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [nextVideoId, setNextVideoId] = useState<string | null>(null);
  const [prevVideoId, setPrevVideoId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch video details
    fetch('http://localhost:3000/api/library/videos')
      .then(res => res.json())
      .then(data => {
        const vid = data.find((v: any) => v.id === videoId);
        if (vid) {
          setFilename(vid.filename);
          setVideoPath(vid.relative_path);
        } else {
          setError('Video not found in library');
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load video details');
      });

    // Check completion status and find adjacent videos
    fetch('http://localhost:3000/api/schedule')
      .then(res => res.json())
      .then(data => {
        const schedule = data.schedule || [];
        const day = schedule.find((d: any) => d.workout?.id === workoutId);
        if (day?.workout) {
          const videos = day.workout.videos || [];
          const currentVideo = videos.find((v: any) => v.id === videoId);
          if (currentVideo?.isCompleted) {
            setIsDone(true);
          } else {
            setIsDone(false);
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
      <div style={{ padding: '2rem', textAlign: 'center', color: 'white', background: '#000', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => navigate(-1)} className="btn">Back</button>
      </div>
    );
  }

  if (!videoPath) {
    return <div style={{ padding: '2rem', textAlign: 'center', background: '#000', color: 'white', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  const videoUrl = `http://localhost:3000/videos/${videoPath.split('/').map(encodeURIComponent).join('/')}`;

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, left: 0, right: 0, bottom: 0, 
      background: 'black',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header Overlay */}
      <div style={{ 
        position: 'absolute', 
        top: 0, left: 0, right: 0, 
        padding: '1.5rem', 
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 20
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: 0, color: 'white', fontSize: '1.2rem', fontWeight: 600 }}>{filename}</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={handleToggleDone} 
            disabled={isMarking}
            style={{ 
              background: isDone ? '#10b981' : 'rgba(255,255,255,0.15)', 
              color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', backdropFilter: 'blur(8px)', fontWeight: 600
            }}
          >
            {isDone ? '✓ This Part Done' : 'Mark Part Done'}
          </button>
          <button 
            onClick={() => navigate(-1)} 
            style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', backdropFilter: 'blur(8px)' }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Video Container */}
      <div 
        style={{ flex: 1, position: 'relative', background: '#000' }}
        onDoubleClick={toggleFullscreen}
      >
        <video 
          ref={videoRef}
          src={videoUrl}
          controls
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onEnded={() => nextVideoId && navigate(`/player/${nextVideoId}/${workoutId}`)}
        />
        
        {/* Floating Navigation */}
        <div style={{ 
          position: 'absolute', 
          bottom: '8%', 
          left: 0, 
          right: 0, 
          display: 'flex', 
          justifyContent: 'center', 
          gap: '3rem',
          zIndex: 30,
          pointerEvents: 'none'
        }}>
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
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
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
                boxShadow: '0 8px 32px rgba(59, 130, 246, 0.3)'
              }}
            >
              Next Video →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
