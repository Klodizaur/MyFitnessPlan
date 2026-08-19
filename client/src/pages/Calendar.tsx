import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import VideoTagChips from '../components/VideoTagChips';

interface ScheduleVideo {
  id: string;
  filename: string;
  thumbnail?: string;
  isCompleted?: boolean;
  equipment?: string[];
  trainingType?: string[];
  bodyParts?: string[];
  intensity?: string;
}

interface ScheduleDay {
  date: string;
  isWorkoutDay: boolean;
  workout: {
    id: string;
    name: string;
    sequence_order: number;
    videos: ScheduleVideo[];
    isCompleted?: boolean;
    videosCompletedCount: number;
    totalVideosCount: number;
  } | null;
}

/** One active plan's schedule. Two plans can be active at once (main + extra). */
interface PlanSchedule {
  slot: 'main' | 'extra';
  planId: string;
  planName: string;
  startDate: string;
  schedule: ScheduleDay[];
}

function CalendarCard({ day, calendarView, navigate }: { day: ScheduleDay, calendarView: string, navigate: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const dateObj = new Date(day.date);
  const isPast = dateObj < new Date(new Date().setHours(0,0,0,0));
  const isToday = day.date === new Date().toISOString().split('T')[0];
  const videos = day.workout?.videos || [];
  const currentVideo = videos[currentIndex];
  const hasThumbnail = currentVideo?.thumbnail;

  const nextVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % videos.length);
  };

  const prevVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + videos.length) % videos.length);
  };

  const workoutNameParts = (day.workout?.name || '')
    .split(/\n+/) // preserve separate lines from uploaded TSVs
    .filter((line, index) => {
      // Skip the first line if it matches "Week X - Day Y" pattern
      if (index === 0 && /^week\s*\d+\s*-\s*day\s*\d+/i.test(line.trim())) {
        return false;
      }
      return true;
    })
    .flatMap(part => part.split(/(\s+\(\d+\s+min\)\s*)/))
    .filter(Boolean) || [];

  return (
    <div 
      className="glass-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: isToday ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
        opacity: isPast ? 0.6 : 1,
        overflow: 'hidden',
        height: '100%',
        transition: 'transform 0.2s',
      }}
    >
      <div style={{ 
        height: '4px', 
        width: '100%', 
        background: day.isWorkoutDay ? (day.workout?.isCompleted ? '#10b981' : 'var(--accent-color)') : 'var(--rest-color)' 
      }} />

      {day.isWorkoutDay ? (
        <div style={{ 
          width: '100%', 
          aspectRatio: '16/9', 
          background: 'rgba(0,0,0,0.2)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {hasThumbnail ? (
            <img 
              src={`/thumbnails/${currentVideo.thumbnail}`} 
              alt={currentVideo.filename} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ 
              width: '100%', 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem'
            }}>
              {t('calendar.no_preview')}
            </div>
          )}
          
          {isToday && (
            <div style={{ 
              position: 'absolute', 
              top: '10px', 
              right: '10px', 
              background: 'var(--accent-color)', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '4px', 
              fontSize: '0.7rem', 
              fontWeight: 'bold',
              zIndex: 10
            }}>
              {t('calendar.today').toUpperCase()}
            </div>
          )}

          {currentVideo?.isCompleted && (
             <div style={{ 
              position: 'absolute', 
              top: '10px', 
              left: '10px', 
              background: '#10b981', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '4px', 
              fontSize: '0.75rem', 
              fontWeight: 'bold',
              zIndex: 10
            }}>
              ✓ {t('calendar.done')}
            </div>
          )}

          {calendarView === 'slider' && videos.length > 1 && (
            <>
              <button 
                onClick={prevVideo}
                className="slider-nav-btn"
                style={{ left: '10px' }}
                aria-label="Previous video"
              >
                <span>‹</span>
              </button>
              <button 
                onClick={nextVideo}
                className="slider-nav-btn"
                style={{ right: '10px' }}
                aria-label="Next video"
              >
                <span>›</span>
              </button>
              <div style={{ 
                position: 'absolute', 
                bottom: '12px', 
                left: '50%', 
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(4px)',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem', 
                color: 'white', 
                fontWeight: 'bold',
                zIndex: 5 
              }}>
                {currentIndex + 1} / {videos.length}
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ 
          width: '100%', 
          aspectRatio: '16/9', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.1)'
        }}>
           <h2 style={{ color: 'var(--rest-color)', letterSpacing: '4px', margin: 0, opacity: 0.5 }}>{t('calendar.rest')}</h2>
        </div>
      )}

      {/* Tags for whatever the preview above is currently showing — the slider's
          selected part, or the day's first video in list view. */}
      {day.isWorkoutDay && currentVideo && (
        <VideoTagChips
          className="calendar-card-tags"
          intensity={currentVideo.intensity}
          trainingType={currentVideo.trainingType}
          bodyParts={currentVideo.bodyParts}
          equipment={currentVideo.equipment}
        />
      )}

      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: day.workout?.isCompleted ? '#10b981' : 'var(--accent-color)', textTransform: 'uppercase' }}>
              {dateObj.toLocaleDateString(i18n.language, { weekday: 'long' })}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {dateObj.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}
            </span>
          </div>
          {day.workout && day.workout.totalVideosCount > 1 && (
            <div style={{ fontSize: '0.75rem', fontWeight: 800, background: 'rgba(0,0,0,0.1)', padding: '2px 8px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
              {day.workout.videosCompletedCount} / {day.workout.totalVideosCount}
            </div>
          )}
        </div>

        {day.isWorkoutDay ? (
          <>
            <div style={{ 
              marginBottom: '1.25rem', 
              flex: 1, 
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {workoutNameParts.length > 1 ? (
                workoutNameParts.map((part, i) => (
                  <span key={i} style={{ 
                    fontSize: '0.8rem', 
                    color: 'var(--text-primary)', 
                    lineHeight: '1.2',
                    fontWeight: 500
                  }}>
                    {part.trim()}
                  </span>
                ))
              ) : (
                <span style={{ 
                  fontSize: '0.85rem', 
                  color: 'var(--text-primary)', 
                  lineHeight: '1.4',
                  fontWeight: 600
                }}>
                  {day.workout!.name}
                </span>
              )}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
              {calendarView === 'slider' ? (
                videos.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic', wordBreak: 'break-all' }}>
                      {currentVideo.filename}
                    </div>
                    <button 
                      className="btn" 
                      style={{ 
                        width: '100%', 
                        fontSize: '0.85rem', 
                        padding: '10px',
                        background: currentVideo.isCompleted ? '#10b981' : (isPast ? 'var(--surface-hover)' : 'var(--accent-color)'),
                        color: (currentVideo.isCompleted || !isPast) ? 'white' : 'var(--text-primary)'
                      }}
                      onClick={() => navigate(`/player/${currentVideo.id}/${day.workout!.id}`)}
                    >
                      {currentVideo.isCompleted 
                        ? (videos.length > 1 ? t('calendar.review_part', { index: currentIndex + 1 }) : t('calendar.review_workout'))
                        : (videos.length > 1 ? t('calendar.play_part', { index: currentIndex + 1 }) : t('calendar.start_workout'))}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('calendar.no_video_matched')}</div>
                )
              ) : (
                videos.length > 0 ? (
                  videos.map((vid, i) => (
                    <button 
                      key={i}
                      className="btn" 
                      style={{ 
                        width: '100%', 
                        fontSize: '0.8rem', 
                        padding: '10px',
                        background: vid.isCompleted ? '#10b981' : (isPast ? 'var(--surface-hover)' : 'var(--accent-color)'),
                        color: (vid.isCompleted || !isPast) ? 'white' : 'var(--text-primary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        textAlign: 'left'
                      }}
                      onClick={() => navigate(`/player/${vid.id}/${day.workout!.id}`)}
                    >
                      <span style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>
                        {videos.length > 1 ? t('calendar.part', { index: i + 1 }) + ': ' : ''}{vid.filename}
                      </span>
                      {vid.isCompleted && <span>✓</span>}
                    </button>
                  ))
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('calendar.no_video_matched')}</div>
                )
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
             <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('calendar.take_breather')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Calendar() {
  const { t } = useTranslation();
  const [planSchedules, setPlanSchedules] = useState<PlanSchedule[]>([]);
  const [calendarView, setCalendarView] = useState('list');
  // Which active plan's calendar is on screen. The two plans run on their own
  // dates, so they're shown one at a time rather than interleaved by day.
  const [selectedSlot, setSelectedSlot] = useState<'main' | 'extra'>('main');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.calendar_view) setCalendarView(data.calendar_view);
      });

    fetch('/api/schedule')
      .then(res => res.json())
      .then(data => {
        setPlanSchedules(data.schedules || []);
      });
  }, []);

  if (planSchedules.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>{t('calendar.no_active_schedule')}</h2>
        <p>{t('calendar.upload_in_settings')}</p>
      </div>
    );
  }

  // Falls back to the first schedule so activating only an extra plan (or
  // deactivating the main one) still shows a calendar.
  const selected = planSchedules.find(p => p.slot === selectedSlot) || planSchedules[0];

  return (
    <div className="animate-fade-in">
      <h1 style={{ marginBottom: planSchedules.length > 1 ? '1rem' : '2rem' }}>
        {selected.planName || t('calendar.workout_calendar')}
      </h1>

      {planSchedules.length > 1 && (
        <div className="calendar-plan-tabs" role="tablist">
          {planSchedules.map(plan => (
            <button
              key={plan.planId}
              type="button"
              role="tab"
              aria-selected={plan.slot === selected.slot}
              className={`calendar-plan-tab${plan.slot === selected.slot ? ' selected' : ''}`}
              onClick={() => setSelectedSlot(plan.slot)}
            >
              <span className="calendar-plan-tab-slot">
                {plan.slot === 'main' ? t('plans.slot_main') : t('plans.slot_extra')}
              </span>
              <span className="calendar-plan-tab-name">{plan.planName}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '2rem'
      }}>
        {selected.schedule.map((day, index) => (
          <CalendarCard key={`${selected.planId}:${index}`} day={day} calendarView={calendarView} navigate={navigate} />
        ))}
      </div>
    </div>
  );
}
