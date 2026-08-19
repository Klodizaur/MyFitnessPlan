import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { topLevelAlbumKey, toAlbumRouteParam } from '../lib/paths';

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

interface PlanInfo {
  name: string;
  totalWorkouts: number;
  completedWorkouts: number;
  firstDate: string;
  lastDate: string;
}

/** One active plan's schedule. Two can run at once: a main plan and an extra. */
interface PlanSchedule {
  slot: 'main' | 'extra';
  planId: string;
  planName: string;
  startDate: string;
  schedule: ScheduleDay[];
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [planSchedules, setPlanSchedules] = useState<PlanSchedule[]>([]);
  // Which active plan the hero is showing. Both plans run at once, so the
  // dashboard shows one at a time and lets you step between them rather than
  // stacking two heroes or silently hiding the second.
  const [planIndex, setPlanIndex] = useState(0);
  const [libraryPreview, setLibraryPreview] = useState<{ key: string; title: string; cover?: string | null; count: number }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/schedule')
      .then(res => res.json())
      .then(data => setPlanSchedules(data.schedules || []));
  }, []);

  const selectedPlan = planSchedules[planIndex] || null;

  // Everything the page renders is derived from whichever plan is selected, so
  // stepping to the extra plan moves the hero, the banner and the progress
  // panels together.
  const { todaySchedule, upcomingWorkouts, planInfo } = useMemo(() => {
    const schedule = selectedPlan?.schedule || [];
    if (schedule.length === 0) {
      return { todaySchedule: null as ScheduleDay | null, upcomingWorkouts: [] as ScheduleDay[], planInfo: null as PlanInfo | null };
    }

    const today = new Date().toISOString().split('T')[0];
    const workoutDays = schedule.filter(d => d.isWorkoutDay);
    const info: PlanInfo = {
      name: selectedPlan?.planName || '',
      totalWorkouts: workoutDays.length,
      completedWorkouts: workoutDays.filter(d => d.workout?.isCompleted).length,
      firstDate: schedule[0].date,
      lastDate: schedule[schedule.length - 1].date,
    };

    const todayIndex = schedule.findIndex(d => d.date === today);
    if (todayIndex === -1) {
      return { todaySchedule: null as ScheduleDay | null, upcomingWorkouts: [] as ScheduleDay[], planInfo: info };
    }

    return {
      todaySchedule: schedule[todayIndex],
      // Next two workouts, skipping rest days.
      upcomingWorkouts: schedule.slice(todayIndex + 1).filter(d => d.isWorkoutDay).slice(0, 2),
      planInfo: info,
    };
  }, [selectedPlan]);

  useEffect(() => {
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: any[]) => {
        const map = new Map<string, any[]>();
        for (const v of data || []) {
          const rel = v.relative_path || '';
          // Group by top-level folder (first segment) or '.' for root
          const key = topLevelAlbumKey(rel);
          const arr = map.get(key) || [];
          arr.push(v);
          map.set(key, arr);
        }
        const albums = Array.from(map.entries()).slice(0, 4).map(([key, vids]) => ({ key, title: key === '.' ? 'Root' : key, cover: vids[0]?.thumbnail_path ? `/thumbnails/${vids[0].thumbnail_path}` : null, count: vids.length }));
        setLibraryPreview(albums);
      }).catch(() => {});
  }, []);

  const firstPendingVideo = todaySchedule?.workout?.videos.find(v => !v.isCompleted) || todaySchedule?.workout?.videos[0];

  // Where "today" falls relative to the active plan's schedule window.
  const todayStr = new Date().toISOString().split('T')[0];
  const planStatus: 'none' | 'upcoming' | 'active' | 'ended' = !planInfo
    ? 'none'
    : todayStr < planInfo.firstDate
    ? 'upcoming'
    : todayStr > planInfo.lastDate
    ? 'ended'
    : 'active';
  const planDaysLeft = planInfo
    ? Math.max(0, Math.round((new Date(planInfo.lastDate).getTime() - new Date(todayStr).getTime()) / 86400000))
    : 0;

  const stripExt = (name: string) => name.replace(/\.[^/.]+$/, '');

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

      {/* Active plan status banner */}
      {planInfo && planStatus === 'active' && (
        <div className="glass-card" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '-1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ background: 'var(--accent-color)', color: 'white', padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>
              {planSchedules.length > 1 && selectedPlan
                ? t(selectedPlan.slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')
                : t('dashboard.active_plan')}
            </span>
            <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{planInfo.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>{t('dashboard.plan_progress', { completed: planInfo.completedWorkouts, total: planInfo.totalWorkouts })}</span>
            <span style={{ fontWeight: 700, color: planDaysLeft <= 3 ? 'var(--accent-color)' : 'var(--text-primary)' }}>
              {planDaysLeft === 0 ? t('dashboard.plan_last_day') : t('dashboard.plan_days_left', { count: planDaysLeft })}
            </span>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div 
        className={`glass-card${planSchedules.length > 1 ? ' dashboard-hero-paged' : ''}${
          todaySchedule?.isWorkoutDay && firstPendingVideo?.thumbnail ? ' dashboard-hero-has-thumb' : ''
        }`}
        style={{ 
          position: 'relative',
          minHeight: '400px',
          display: 'flex',
          overflow: 'hidden',
          borderRadius: '24px',
          border: todaySchedule?.workout?.isCompleted ? '2px solid #10b981' : '1px solid var(--glass-border)',
        }}
      >
        {/* With a second plan active, the hero becomes a pager over both rather
            than a second card: same container, one plan at a time. */}
        {planSchedules.length > 1 && (
          <>
            <button
              type="button"
              className="slider-nav-btn dashboard-plan-nav"
              style={{ left: '14px' }}
              aria-label={t('plans.scroll_prev')}
              onClick={() => setPlanIndex(i => (i - 1 + planSchedules.length) % planSchedules.length)}
            >
              <span>‹</span>
            </button>
            <button
              type="button"
              className="slider-nav-btn dashboard-plan-nav"
              style={{ right: '14px' }}
              aria-label={t('plans.scroll_next')}
              onClick={() => setPlanIndex(i => (i + 1) % planSchedules.length)}
            >
              <span>›</span>
            </button>
            <div className="dashboard-plan-dots">
              {planSchedules.map((plan, index) => (
                <button
                  key={plan.planId}
                  type="button"
                  className={`dashboard-plan-dot${index === planIndex ? ' selected' : ''}`}
                  aria-label={plan.planName}
                  onClick={() => setPlanIndex(index)}
                />
              ))}
            </div>
          </>
        )}

        {todaySchedule ? (
          <>
            <div style={{ 
              position: 'absolute', 
              top: 0, left: 0, right: 0, bottom: 0, 
              zIndex: 0,
              // Longhands, not the `background` shorthand. Paging to the other
              // plan changes only the image; React would then re-set the
              // shorthand, which resets background-size back to `auto` — and
              // because `cover` itself hasn't changed, React doesn't re-apply
              // it, leaving the thumbnail tiled at its natural size.
              backgroundColor: 'var(--surface-color)',
              backgroundImage: todaySchedule.isWorkoutDay && firstPendingVideo?.thumbnail
                ? `url(/thumbnails/${firstPendingVideo.thumbnail})`
                : 'none',
              backgroundSize: 'cover',
              backgroundRepeat: 'no-repeat',
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
                  <img src={`/thumbnails/${firstPendingVideo.thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', fontSize: '0.65rem', color: 'white' }}>
                    {firstPendingVideo.filename}
                  </div>
               </div>
            )}
          </>
        ) : planInfo && planStatus === 'ended' ? (
          <div style={{ padding: '3rem', textAlign: 'center', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '3.5rem' }}>🎉</div>
            <h2 style={{ margin: 0 }}>{t('dashboard.plan_finished_title', { plan: planInfo.name })}</h2>
            <p style={{ margin: 0, maxWidth: 520 }}>
              {t('dashboard.plan_finished_msg', { completed: planInfo.completedWorkouts, total: planInfo.totalWorkouts })}
            </p>
            <button className="btn" style={{ marginTop: '1.25rem' }} onClick={() => navigate('/plans')}>{t('dashboard.plan_finished_cta')}</button>
          </div>
        ) : planInfo && planStatus === 'upcoming' ? (
          <div style={{ padding: '3rem', textAlign: 'center', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '3.5rem' }}>🗓️</div>
            <h2 style={{ margin: 0 }}>{planInfo.name}</h2>
            <p style={{ margin: 0 }}>
              {t('dashboard.plan_starts_on', { date: new Date(planInfo.firstDate + 'T00:00:00').toLocaleDateString(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' }) })}
            </p>
            <button className="btn" style={{ marginTop: '1.25rem' }} onClick={() => navigate('/calendar')}>{t('dashboard.full_plan')}</button>
          </div>
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
                        <img src={`/thumbnails/${day.workout.videos[0].thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>🔥</div>
                      )}
                   </div>
                   <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase' }}>
                        {new Date(day.date).toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      {/* One line per video, never a merged blob of titles */}
                      {(day.workout?.videos?.length
                        ? day.workout.videos.map(v => stripExt(v.filename))
                        : (day.workout?.name || '').split(/\n+/).filter(Boolean)
                      ).map((title, j) => (
                        <div key={j} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {title}
                        </div>
                      ))}
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
              <div key={a.key} style={{ width: 180, cursor: 'pointer' }} onClick={() => navigate(`/library/${encodeURIComponent(toAlbumRouteParam(a.key))}`)}>
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
