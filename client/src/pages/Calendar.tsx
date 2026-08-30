import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VideoTagChips from '../components/VideoTagChips';
import FreezePlanModal from '../components/FreezePlanModal';
import { FREEZE_REASON_EMOJI, FreezeReason } from '../lib/freeze';
import { useToday } from '../lib/dates';
import { EquipmentIcon } from '../lib/equipment';
import { TrainingTypeIcon, BodyPartIcon, IntensityIcon } from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';

interface ScheduleVideo {
  id: string;
  filename: string;
  thumbnail?: string;
  isCompleted?: boolean;
  equipment?: string[];
  trainingType?: string[];
  bodyParts?: string[];
  intensity?: string;
  description?: string;
  /** Probed at scan time — present for nearly every local video even when
   *  nobody has ever tagged or described it, so the tape's hero card always
   *  has something concrete to show. */
  duration?: number | null;
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
  /** Set when this day was frozen; the workout that would've landed here is
   *  deferred to the next open workout day (isWorkoutDay/workout above are
   *  already null in that case), pushing the rest of the schedule back. */
  frozen: FreezeReason | null;
}

/** One active plan's schedule. Two plans can be active at once (main + extra). */
interface PlanSchedule {
  slot: 'main' | 'extra';
  planId: string;
  planName: string;
  startDate: string;
  backgroundImage: string | null;
  category: string | null;
  schedule: ScheduleDay[];
}

function CalendarCard({ day, calendarView, navigate, today, onFreeze, onUnfreeze, unfreezing }: {
  day: ScheduleDay,
  calendarView: string,
  navigate: (path: string) => void,
  today: string,
  /** Opens the reason picker for today's card. Absent on any other day — freezing only ever targets today. */
  onFreeze?: () => void,
  onUnfreeze: (date: string) => void,
  unfreezing: boolean,
}) {
  const { t, i18n } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const dateObj = new Date(day.date);
  const isPast = dateObj < new Date(new Date().setHours(0,0,0,0));
  // `today` comes from the page so every card agrees, and so it moves on when
  // the day turns over with the app left open.
  const isToday = day.date === today;
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
        background: day.frozen ? '#38bdf8' : day.isWorkoutDay ? (day.workout?.isCompleted ? '#10b981' : 'var(--accent-color)') : 'var(--rest-color)'
      }} />

      {day.frozen ? (
        <div style={{
          width: '100%',
          aspectRatio: '16/9',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
          background: 'rgba(56, 189, 248, 0.08)',
        }}>
          <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>{FREEZE_REASON_EMOJI[day.frozen]}</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '2px' }}>
            {t(`calendar.freeze_reason_${day.frozen}`)}
          </span>
        </div>
      ) : day.isWorkoutDay ? (
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
      {!day.frozen && day.isWorkoutDay && currentVideo && (
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {!day.frozen && day.workout && day.workout.totalVideosCount > 1 && (
              <div style={{ fontSize: '0.75rem', fontWeight: 800, background: 'rgba(0,0,0,0.1)', padding: '2px 8px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                {day.workout.videosCompletedCount} / {day.workout.totalVideosCount}
              </div>
            )}
            {/* Freeze only ever targets today; a past/future day has no trigger. */}
            {isToday && !day.frozen && onFreeze && (
              <button
                type="button"
                className="calendar-freeze-btn"
                onClick={onFreeze}
                title={t('calendar.freeze_button')}
                aria-label={t('calendar.freeze_button')}
              >
                ❄️
              </button>
            )}
          </div>
        </div>

        {day.frozen ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              {t('calendar.frozen_caption')}
            </p>
            <button
              type="button"
              className="btn btn-secondary calendar-unfreeze-btn"
              disabled={unfreezing}
              onClick={() => onUnfreeze(day.date)}
            >
              {t('calendar.unfreeze_button')}
            </button>
          </div>
        ) : day.isWorkoutDay ? (
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

/**
 * The tape view's single-day detail — full-bleed, not a bordered card sitting
 * on the page. The image spans the whole content width, and the tags,
 * description, and actions sit directly on the page background beneath it,
 * the way a dedicated screen looks rather than a widget.
 */
function TapeDetail({ day, navigate, today, onUnfreeze, unfreezing }: {
  day: ScheduleDay;
  navigate: (path: string) => void;
  today: string;
  onUnfreeze: (date: string) => void;
  unfreezing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();
  const [currentIndex, setCurrentIndex] = useState(0);

  const dateObj = new Date(day.date);
  const isToday = day.date === today;
  const videos = day.workout?.videos || [];
  const currentVideo = videos[currentIndex];
  const hasThumbnail = currentVideo?.thumbnail;

  const nextVideo = () => setCurrentIndex(i => (i + 1) % videos.length);
  const prevVideo = () => setCurrentIndex(i => (i - 1 + videos.length) % videos.length);

  // One line per part, in video order — a multi-video day's workout.name is a
  // newline-joined list of each part's own title. Only the part matching
  // whichever video is on screen should show, so the arrows change the title
  // and description together with the thumbnail rather than leaving them
  // fixed while just the image moves underneath.
  const workoutNameParts = (day.workout?.name || '')
    .split(/\n+/)
    .filter((line, index) => !(index === 0 && /^week\s*\d+\s*-\s*day\s*\d+/i.test(line.trim())))
    .flatMap(part => part.split(/(\s+\(\d+\s+min\)\s*)/))
    .filter(Boolean);
  const currentTitle =
    (workoutNameParts.length > 1 ? workoutNameParts[currentIndex]?.trim() : null) ||
    workoutNameParts[0]?.trim() ||
    currentVideo?.filename?.replace(/\.[^/.]+$/, '') ||
    day.workout?.name ||
    '';

  if (day.frozen) {
    // Freezing counts as rest too, so it gets the same compact banner as a
    // rest day instead of a huge mostly-empty image-shaped hero box.
    return (
      <div className="calendar-tape-detail">
        <div className="calendar-tape-detail-toprow">
          <div>
            <div className="calendar-tape-detail-weekday">{dateObj.toLocaleDateString(i18n.language, { weekday: 'long' })}</div>
            <div className="calendar-tape-detail-date">{dateObj.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div className="calendar-tape-detail-frozen">
          <span className="calendar-tape-detail-frozen-emoji">{FREEZE_REASON_EMOJI[day.frozen]}</span>
          <span className="calendar-tape-detail-frozen-label">{t(`calendar.freeze_reason_${day.frozen}`)}</span>
          <p>{t('calendar.frozen_caption')}</p>
          <button type="button" className="btn btn-secondary" disabled={unfreezing} onClick={() => onUnfreeze(day.date)}>
            {t('calendar.unfreeze_button')}
          </button>
        </div>
      </div>
    );
  }

  if (!day.isWorkoutDay) {
    // No thumbnail-sized hero here — that box is sized for a video image, and
    // a rest day has nothing to fill it with, so it's a compact banner instead.
    return (
      <div className="calendar-tape-detail">
        <div className="calendar-tape-detail-toprow">
          <div>
            <div className="calendar-tape-detail-weekday">{dateObj.toLocaleDateString(i18n.language, { weekday: 'long' })}</div>
            <div className="calendar-tape-detail-date">{dateObj.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div className="calendar-tape-detail-rest">
          <h2>{t('calendar.rest')}</h2>
          <p>{t('calendar.take_breather')}</p>
        </div>
      </div>
    );
  }

  // Workout day: thumbnail + play button on one side, everything to read on
  // the other — a full-bleed thumbnail looked great in the mockup but blown
  // up to desktop width it just enlarges how soft these thumbnails actually
  // are, so it stays a contained image instead of stretching edge to edge.
  return (
    <div className="calendar-tape-detail calendar-tape-detail-workout">
      <div className="calendar-tape-detail-media">
        <div className="calendar-tape-detail-hero">
          {hasThumbnail ? (
            <img src={`/thumbnails/${currentVideo.thumbnail}`} alt={currentVideo.filename} />
          ) : (
            <div className="calendar-tape-detail-noimg">{t('calendar.no_preview')}</div>
          )}

          {isToday && <div className="calendar-tape-detail-badge today">{t('calendar.today').toUpperCase()}</div>}
          {currentVideo?.isCompleted && <div className="calendar-tape-detail-badge done">✓ {t('calendar.done')}</div>}
          {!!currentVideo?.duration && (
            <div className="calendar-tape-duration-badge">
              <span className="calendar-tape-duration-num">{Math.round(currentVideo.duration / 60)}</span>
              <span className="calendar-tape-duration-unit">{t('calendar.duration_min')}</span>
            </div>
          )}

          {videos.length > 1 && (
            <>
              <button onClick={prevVideo} className="slider-nav-btn" style={{ left: '10px' }} aria-label="Previous video"><span>‹</span></button>
              <button onClick={nextVideo} className="slider-nav-btn" style={{ right: '10px' }} aria-label="Next video"><span>›</span></button>
              <div className="calendar-tape-detail-count">{currentIndex + 1} / {videos.length}</div>
            </>
          )}
        </div>

        {videos.length > 0 ? (
          <button
            className="btn calendar-tape-detail-cta"
            style={{
              background: currentVideo.isCompleted ? '#10b981' : 'var(--accent-color)',
              color: 'white',
            }}
            onClick={() => navigate(`/player/${currentVideo.id}/${day.workout!.id}`)}
          >
            {currentVideo.isCompleted
              ? (videos.length > 1 ? t('calendar.review_part', { index: currentIndex + 1 }) : t('calendar.review_workout'))
              : (videos.length > 1 ? t('calendar.play_part', { index: currentIndex + 1 }) : t('calendar.start_workout'))}
          </button>
        ) : (
          <div className="calendar-tape-detail-empty">{t('calendar.no_video_matched')}</div>
        )}
      </div>

      <div className="calendar-tape-detail-body">
        <div className="calendar-tape-detail-toprow">
          <div>
            <div className="calendar-tape-detail-weekday">{dateObj.toLocaleDateString(i18n.language, { weekday: 'long' })}</div>
            <div className="calendar-tape-detail-date">{dateObj.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' })}</div>
          </div>
        </div>

        <h2 className="calendar-tape-detail-title">{currentTitle}</h2>

        {currentVideo?.description?.trim() && (
          <div className="calendar-tape-description">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentVideo.description}</ReactMarkdown>
          </div>
        )}

        {/* Categorized like the player's own tags panel. */}
        {currentVideo && (
          <div className="calendar-tape-detail-tag-groups">
            {!!currentVideo.intensity && (
              <div className="calendar-tape-detail-tag-group">
                <div className="calendar-tape-detail-tag-label">{labels.sections.intensity}</div>
                <div className="calendar-tape-detail-tag-row">
                  <span className="calendar-tape-detail-tag intensity">
                    <IntensityIcon level={currentVideo.intensity} />
                    {labels.intensity(currentVideo.intensity)}
                  </span>
                </div>
              </div>
            )}

            {!!currentVideo.trainingType?.length && (
              <div className="calendar-tape-detail-tag-group">
                <div className="calendar-tape-detail-tag-label">{labels.sections.trainingType}</div>
                <div className="calendar-tape-detail-tag-row">
                  {Array.from(new Set(currentVideo.trainingType)).map(tt => (
                    <span key={tt} className="calendar-tape-detail-tag">
                      <TrainingTypeIcon type={tt} />
                      {labels.trainingType(tt)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!!currentVideo.bodyParts?.length && (
              <div className="calendar-tape-detail-tag-group">
                <div className="calendar-tape-detail-tag-label">{labels.sections.bodyParts}</div>
                <div className="calendar-tape-detail-tag-row">
                  {Array.from(new Set(currentVideo.bodyParts)).map(bp => (
                    <span key={bp} className="calendar-tape-detail-tag" title={labels.bodyPart(bp)}>
                      <BodyPartIcon part={bp} />
                      {labels.bodyPart(bp)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!!currentVideo.equipment?.length && (
              <div className="calendar-tape-detail-tag-group">
                <div className="calendar-tape-detail-tag-label">{labels.sections.equipment}</div>
                <div className="calendar-tape-detail-tag-row">
                  {Array.from(new Set(currentVideo.equipment)).map(id => (
                    <span key={id} className="calendar-tape-detail-tag" title={labels.equipment(id)}>
                      <EquipmentIcon id={id} size={15} />
                      {labels.equipment(id)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A horizontal strip of day numbers — pick one to see just that day's card
 * below, rather than scrolling a grid of every day. Workout days get a dot
 * under the number; rest days don't. Modeled on the "tape" pattern from
 * Codziennie Fit: one video in focus at a time, dates as the navigation.
 */
function DayTape({ days, selectedDate, onSelect, today }: {
  days: ScheduleDay[];
  selectedDate: string;
  onSelect: (date: string) => void;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    // Only when the selected date changes — not on every re-render, which
    // would fight the user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const scrollByPage = (dir: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: dir * scrollerRef.current.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Grouped into 7-day weeks counting from the schedule's own first day (the
  // plan's start date) — not the calendar week — so "Week 1" always means the
  // plan's actual first week.
  const weeks: ScheduleDay[][] = [];
  days.forEach((day, i) => {
    const weekIndex = Math.floor(i / 7);
    if (!weeks[weekIndex]) weeks[weekIndex] = [];
    weeks[weekIndex].push(day);
  });

  return (
    <div className="calendar-tape-bleed">
      <div className="calendar-tape" role="tablist" aria-label="Day" ref={scrollerRef}>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className={`calendar-tape-week${weekIndex % 2 === 1 ? ' alt' : ''}`}>
            <div className="calendar-tape-week-label">{t('calendar.week_label', { number: weekIndex + 1 })}</div>
            <div className="calendar-tape-week-days">
              {week.map(day => {
                const dateObj = new Date(day.date);
                const isSelected = day.date === selectedDate;
                const isToday = day.date === today;
                return (
                  <button
                    key={day.date}
                    ref={isSelected ? selectedRef : undefined}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`calendar-tape-day${isSelected ? ' selected' : ''}${isToday ? ' is-today' : ''}${day.frozen ? ' frozen' : ''}`}
                    onClick={() => onSelect(day.date)}
                    title={dateObj.toLocaleDateString(i18n.language, { weekday: 'long', month: 'short', day: 'numeric' })}
                  >
                    <span className="calendar-tape-num">{dateObj.getDate()}</span>
                    {day.frozen ? (
                      <span className="calendar-tape-frozen-mark" aria-hidden="true">{FREEZE_REASON_EMOJI[day.frozen]}</span>
                    ) : (
                      <span className={`calendar-tape-dot${day.isWorkoutDay ? ' active' : ''}`} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="calendar-tape-arrows">
        <button type="button" className="calendar-tape-arrow" onClick={() => scrollByPage(-1)} aria-label="Scroll days back">
          <span>‹</span>
        </button>
        <button type="button" className="calendar-tape-arrow" onClick={() => scrollByPage(1)} aria-label="Scroll days forward">
          <span>›</span>
        </button>
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
  // 'full' = the header button, which can block out several days ahead.
  // 'day' = a single day card's own toggle, always exactly that one day.
  const [freezeModalMode, setFreezeModalMode] = useState<'full' | 'day' | null>(null);
  const [freezeSaving, setFreezeSaving] = useState(false);
  // The one day currently mid-unfreeze, so only its button disables.
  const [unfreezingDate, setUnfreezingDate] = useState<string | null>(null);
  // Which day the tape view has open. Empty until the schedule loads, at
  // which point it defaults to today (see the effect below).
  const [tapeDate, setTapeDate] = useState<string | null>(null);
  const today = useToday();
  const navigate = useNavigate();

  const loadSchedule = () => {
    fetch('/api/schedule')
      .then(res => res.json())
      .then(data => {
        setPlanSchedules(data.schedules || []);
      });
  };

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.calendar_view) setCalendarView(data.calendar_view);
      });

    loadSchedule();
  }, []);

  // Falls back to the first schedule so activating only an extra plan (or
  // deactivating the main one) still shows a calendar.
  const selected = planSchedules.find(p => p.slot === selectedSlot) || planSchedules[0];

  // Tape view's selected day: today if the schedule reaches that far, else the
  // schedule's own last day. Re-picks whenever the visible plan changes (a
  // tab switch, or the schedule loading in for the first time) rather than
  // carrying a date from the previous plan that this one may not even have.
  useEffect(() => {
    if (!selected) return;
    const days = selected.schedule;
    if (days.some(d => d.date === today)) {
      setTapeDate(today);
    } else if (days.length > 0) {
      setTapeDate(days[days.length - 1].date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.planId]);

  if (planSchedules.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>{t('calendar.no_active_schedule')}</h2>
        <p>{t('calendar.upload_in_settings')}</p>
      </div>
    );
  }

  // Which date the header button acts on: in tape view that's whichever day
  // is currently open (freezing "from here" should toggle based on what's
  // actually in view, not always today — the day you're looking at may not
  // even be part of today's frozen range), elsewhere there's no single day in
  // focus so it falls back to today, same as freezing itself does.
  const headerDate = calendarView === 'tape' ? (tapeDate ?? today) : today;
  const headerFrozen = selected.schedule.find(d => d.date === headerDate)?.frozen ?? null;

  const handleFreeze = async (reason: FreezeReason, days: number) => {
    setFreezeSaving(true);
    try {
      // In tape view the header button freezes forward from whichever day is
      // currently open, not always from today — otherwise browsing ahead to a
      // future day and freezing "from here" would instead freeze backward,
      // starting at today. The single-day card trigger is unaffected: it only
      // ever appears on today's own card, so it has nothing to disambiguate.
      const startDate = freezeModalMode === 'full' ? headerDate : today;
      const res = await fetch('/api/schedule/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selected.planId, reason, days, startDate }),
      });
      if (res.ok) {
        setFreezeModalMode(null);
        loadSchedule();
      }
    } finally {
      setFreezeSaving(false);
    }
  };

  const handleUnfreeze = async (date: string) => {
    setUnfreezingDate(date);
    try {
      const res = await fetch(`/api/schedule/freeze/${encodeURIComponent(selected.planId)}/${encodeURIComponent(date)}`, {
        method: 'DELETE',
      });
      if (res.ok) loadSchedule();
    } finally {
      setUnfreezingDate(null);
    }
  };

  // The header button pairs with its own "freeze the next N days" tool, so
  // undoing it clears every day from today on — not just today — rather than
  // leaving the rest of the batch stranded. This also correctly clears a
  // batch that was frozen starting from a future day, since any such batch
  // starts at or after today by construction.
  const handleUnfreezeAll = async () => {
    setUnfreezingDate(headerDate);
    try {
      const res = await fetch(`/api/schedule/freeze/${encodeURIComponent(selected.planId)}`, { method: 'DELETE' });
      if (res.ok) loadSchedule();
    } finally {
      setUnfreezingDate(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="calendar-title-row" style={{ marginBottom: planSchedules.length > 1 ? '1rem' : '2rem' }}>
        <h1 style={{ margin: 0 }}>{selected.planName || t('calendar.workout_calendar')}</h1>
        {headerFrozen ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={unfreezingDate === headerDate}
            onClick={handleUnfreezeAll}
          >
            {FREEZE_REASON_EMOJI[headerFrozen]} {t('plans.unfreeze')}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setFreezeModalMode('full')}>
            ❄️ {t('plans.freeze')}
          </button>
        )}
      </div>

      {planSchedules.length > 1 && (
        <div className="calendar-plan-tabs" role="tablist">
          {planSchedules.map(plan => {
            const bgUrl = plan.backgroundImage;
            return (
              <button
                key={plan.planId}
                type="button"
                role="tab"
                aria-selected={plan.slot === selected.slot}
                className={`calendar-plan-tab${plan.slot === selected.slot ? ' selected' : ''}`}
                onClick={() => setSelectedSlot(plan.slot)}
              >
                {bgUrl ? (
                  <div className="calendar-plan-tab-bg" style={{ backgroundImage: `url(${bgUrl})` }} />
                ) : (
                  <div className="calendar-plan-tab-bg no-image" />
                )}
                <div className="calendar-plan-tab-scrim" />
                <div className="calendar-plan-tab-content">
                  <span className="calendar-plan-tab-slot">
                    {plan.slot === 'main' ? t('plans.slot_main') : t('plans.slot_extra')}
                  </span>
                  <span className="calendar-plan-tab-name">{plan.planName}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {calendarView === 'tape' ? (
        <>
          <DayTape
            days={selected.schedule}
            selectedDate={tapeDate ?? today}
            onSelect={setTapeDate}
            today={today}
          />
          {(() => {
            const day = selected.schedule.find(d => d.date === (tapeDate ?? today));
            return day ? (
              <TapeDetail
                key={`${selected.planId}:${day.date}`}
                day={day}
                navigate={navigate}
                today={today}
                onUnfreeze={handleUnfreeze}
                unfreezing={unfreezingDate === day.date}
              />
            ) : null;
          })()}
        </>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '2rem'
        }}>
          {selected.schedule.map((day, index) => (
            <CalendarCard
              key={`${selected.planId}:${index}`}
              day={day}
              calendarView={calendarView}
              navigate={navigate}
              today={today}
              onFreeze={day.date === today ? () => setFreezeModalMode('day') : undefined}
              onUnfreeze={handleUnfreeze}
              unfreezing={unfreezingDate === day.date}
            />
          ))}
        </div>
      )}

      {freezeModalMode && (
        <FreezePlanModal
          planName={selected.planName}
          saving={freezeSaving}
          singleDay={freezeModalMode === 'day'}
          onConfirm={handleFreeze}
          onClose={() => setFreezeModalMode(null)}
        />
      )}
    </div>
  );
}
