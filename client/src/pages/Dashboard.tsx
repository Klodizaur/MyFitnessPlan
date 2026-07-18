import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface ScheduleDay {
  date: string;
  isWorkoutDay: boolean;
  workout: {
    id: string;
    name: string;
    videos: {
      id: string;
      filename: string;
      thumbnail?: string;
      isCompleted?: boolean;
    }[];
    isCompleted?: boolean;
    videosCompletedCount: number;
    totalVideosCount: number;
  } | null;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [todaySchedule, setTodaySchedule] = useState<ScheduleDay | null>(null);
  const [upcomingWorkouts, setUpcomingWorkouts] = useState<ScheduleDay[]>([]);
  const [libraryPreview, setLibraryPreview] = useState<{ key: string; title: string; cover?: string | null; count: number }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('http://localhost:3000/api/schedule')
      .then(res => res.json())
      .then(data => {
        if (data.schedule) {
          const today = new Date().toISOString().split('T')[0];
          const todayIndex = data.schedule.findIndex((d: any) => d.date === today);
          
          if (todayIndex !== -1) {
            setTodaySchedule(data.schedule[todayIndex]);
            
            // Find next 2 workouts (skip rest days)
            const nextWorkouts = data.schedule
              .slice(todayIndex + 1)
              .filter((d: any) => d.isWorkoutDay)
              .slice(0, 2);
            setUpcomingWorkouts(nextWorkouts);
          }
        }
      });
  }, []);

  useEffect(() => {
    fetch('http://localhost:3000/api/library/videos')
      .then(r => r.json())
      .then((data: any[]) => {
        const map = new Map<string, any[]>();
        for (const v of data || []) {
          const rel = v.relative_path || '';
          // Group by top-level folder (first segment) or '.' for root
          const key = rel.includes('/') ? rel.split('/')[0] : (rel ? rel : '.');
          const arr = map.get(key) || [];
          arr.push(v);
          map.set(key, arr);
        }
        const albums = Array.from(map.entries()).slice(0, 4).map(([key, vids]) => ({ key, title: key === '.' ? 'Root' : key, cover: vids[0]?.thumbnail_path ? `http://localhost:3000/thumbnails/${vids[0].thumbnail_path}` : null, count: vids.length }));
        setLibraryPreview(albums);
      }).catch(() => {});
  }, []);

  const firstPendingVideo = todaySchedule?.workout?.videos.find(v => !v.isCompleted) || todaySchedule?.workout?.videos[0];

  const workoutNameParts = (todaySchedule?.workout?.name || '')
    .split(/\n+/) // preserve separate lines from uploaded TSVs
    .flatMap(part => part.split(/(\s+\(\d+\s+min\)\s*)/))
    .filter(Boolean) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }} className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>{t('dashboard.welcome_back')}</h1>
          <p style={{ fontSize: '1.1rem' }}>{t('dashboard.on_the_menu')}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
           <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-color)' }}>
             {new Date().toLocaleDateString(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
           </span>
        </div>
      </div>

      {/* Library preview (moved to bottom) */}
      
      {/* Hero Section */}
      <div 
        className="glass-card" 
        style={{ 
          position: 'relative',
          minHeight: '400px',
          display: 'flex',
          overflow: 'hidden',
          borderRadius: '24px',
          border: todaySchedule?.workout?.isCompleted ? '2px solid #10b981' : '1px solid var(--glass-border)',
        }}
      >
        {todaySchedule ? (
          <>
            <div style={{ 
              position: 'absolute', 
              top: 0, left: 0, right: 0, bottom: 0, 
              zIndex: 0,
              background: todaySchedule.isWorkoutDay && firstPendingVideo?.thumbnail 
                ? `url(http://localhost:3000/thumbnails/${firstPendingVideo.thumbnail})` 
                : 'var(--surface-color)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(0.3) blur(2px)',
              transform: 'scale(1.1)'
            }} />

            <div className="dashboard-hero-inner" style={{ 
              position: 'relative', 
              zIndex: 1, 
              width: '100%', 
              display: 'flex', 
              flexDirection: 'column',
              justifyContent: 'center',
              background: 'linear-gradient(90deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)'
            }}>
              {todaySchedule.isWorkoutDay ? (
                <div style={{ maxWidth: '600px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <span style={{ 
                      background: 'var(--accent-color)', 
                      color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px'
                    }}>
                      {t('dashboard.todays_workout')}
                    </span>
                    {todaySchedule.workout?.totalVideosCount! > 1 && (
                      <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', fontWeight: 600 }}>
                        {t('dashboard.parts_completed', { completed: todaySchedule.workout?.videosCompletedCount, total: todaySchedule.workout?.totalVideosCount })}
                      </span>
                    )}
                  </div>

                  <div style={{ marginBottom: '1.5rem' }}>
                    {workoutNameParts.length > 1 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {workoutNameParts.map((part, i) => (
                          <h1 key={i} style={{ fontSize: '1.5rem', margin: 0, color: 'white', lineHeight: '1.1', fontWeight: 600 }}>
                            {part.trim()}
                          </h1>
                        ))}
                      </div>
                    ) : (
                      <h1 style={{ fontSize: '2.5rem', margin: 0, color: 'white', lineHeight: '1.1' }}>
                        {todaySchedule.workout?.name}
                      </h1>
                    )}
                    {todaySchedule.workout?.isCompleted && <div style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: 700, marginTop: '10px' }}>✓ {t('dashboard.completed').toUpperCase()}</div>}
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {firstPendingVideo && (
                      <button 
                        className="btn" 
                        style={{ 
                          fontSize: '1rem', padding: '14px 35px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 10px 25px rgba(59, 130, 246, 0.4)'
                        }}
                        onClick={() => navigate(`/player/${firstPendingVideo.id}/${todaySchedule.workout?.id}`)}
                      >
                        {todaySchedule.workout?.isCompleted ? t('dashboard.review_workout') : (todaySchedule.workout?.videosCompletedCount! > 0 ? t('dashboard.continue') : t('dashboard.start_training'))}
                      </button>
                    )}
                    <button 
                      className="btn btn-secondary" 
                      style={{ fontSize: '1rem', padding: '14px 25px', borderRadius: '12px', color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}
                      onClick={() => navigate('/calendar')}
                    >
                      {t('dashboard.full_plan')}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', width: '100%', maxWidth: 'none' }}>
                  <span style={{ 
                    background: 'var(--rest-color)', color: 'white', padding: '4px 16px', borderRadius: '20px', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '2rem', display: 'inline-block'
                  }}>
                    {t('dashboard.rest_recovery')}
                  </span>
                  <h1 className="dashboard-rest-title" style={{ color: 'white', margin: '1rem 0' }}>{t('dashboard.recharge')}</h1>
                  <p style={{ fontSize: '1.4rem', color: 'rgba(255,255,255,0.7)', maxWidth: '600px', margin: '0 auto' }}>
                    {t('dashboard.rest_msg')}
                  </p>
                </div>
              )}
            </div>

            {todaySchedule.isWorkoutDay && firstPendingVideo?.thumbnail && (
               <div className="dashboard-hero-thumb" style={{ 
                 position: 'absolute', right: '5%', top: '50%', transform: 'translateY(-50%)', width: '280px', aspectRatio: '16/9', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', zIndex: 2
               }}>
                  <img src={`http://localhost:3000/thumbnails/${firstPendingVideo.thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', fontSize: '0.65rem', color: 'white' }}>
                    {firstPendingVideo.filename}
                  </div>
               </div>
            )}
          </>
        ) : (
          <div style={{ padding: '3rem', textAlign: 'center', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h2>{t('dashboard.no_active_plan')}</h2>
            <p style={{ marginBottom: '2rem' }}>{t('dashboard.ready_start')}</p>
            <button className="btn" onClick={() => navigate('/settings')}>{t('dashboard.init_settings')}</button>
          </div>
        )}
      </div>

      {/* Progress & Upcoming Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2.5rem' }}>
        <div className="glass-card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.5rem' }}>📊</span> {t('dashboard.your_progress')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span>{t('dashboard.todays_completion')}</span>
              <span style={{ fontWeight: 700 }}>{todaySchedule?.workout?.videosCompletedCount || 0} / {todaySchedule?.workout?.totalVideosCount || 0}</span>
            </div>
            <div style={{ width: '100%', height: '10px', background: 'var(--progress-bg)', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${todaySchedule?.workout ? (todaySchedule.workout.videosCompletedCount / todaySchedule.workout.totalVideosCount) * 100 : 0}%`, 
                height: '100%', 
                background: '#10b981',
                transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)'
              }} />
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              {todaySchedule?.workout?.isCompleted ? t('dashboard.workout_finished') : t('dashboard.keep_going')}
            </p>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
               <span style={{ fontSize: '1.5rem' }}>🚀</span> {t('dashboard.upcoming')}
            </h3>
            <button 
              onClick={() => navigate('/calendar')}
              style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}
            >
              {t('dashboard.view_all')}
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {upcomingWorkouts.length > 0 ? (
              upcomingWorkouts.map((day, i) => (
                <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                   <div style={{ 
                     width: '60px', height: '60px', borderRadius: '12px', background: 'var(--surface-hover)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--glass-border)'
                   }}>
                      {day.workout?.videos[0]?.thumbnail ? (
                        <img src={`http://localhost:3000/thumbnails/${day.workout.videos[0].thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>🔥</div>
                      )}
                   </div>
                   <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase' }}>
                        {new Date(day.date).toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {day.workout?.name}
                      </div>
                   </div>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('dashboard.no_upcoming')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Library preview (Your collection) - moved to bottom */}
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>📚 {t('dashboard.your_collection')}</h3>
          <button onClick={() => navigate('/library')} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>{t('dashboard.view_all')}</button>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {libraryPreview.length > 0 ? (
            libraryPreview.map(a => (
              <div key={a.key} style={{ width: 180, cursor: 'pointer' }} onClick={() => navigate(`/library/${encodeURIComponent(a.key)}`)}>
                <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                  {a.cover ? <img src={a.cover} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ padding: 12 }}>{a.count} videos</div>}
                </div>
                <div style={{ marginTop: 8, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>No scanned videos yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
