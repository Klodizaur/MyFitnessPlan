import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, RotateCcw, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { topLevelAlbumKey, toAlbumRouteParam } from '../lib/paths';
import { useToday } from '../lib/dates';
import '../styles/dashboard.css';

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
  const today = useToday();
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
  }, [selectedPlan, today]);

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
  const todayStr = today;
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



  /** The schedule returns a bare thumbnail filename, not a URL. */
  const thumbUrl = (file?: string | null) => (file ? `/thumbnails/${file}` : null);

  const heroImage = thumbUrl(firstPendingVideo?.thumbnail);
  const workoutDone = Boolean(todaySchedule?.workout?.isCompleted);
  const isRestDay = Boolean(todaySchedule && !todaySchedule.isWorkoutDay);
  const planPct = planInfo && planInfo.totalWorkouts
    ? Math.round((planInfo.completedWorkouts / planInfo.totalWorkouts) * 100)
    : 0;

  const openWorkout = () => {
    if (!todaySchedule?.workout || !firstPendingVideo) return;
    navigate(`/player/${firstPendingVideo.id}/${todaySchedule.workout.id}`);
  };

  const dateLine = new Date().toLocaleDateString(i18n.language, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="rx-wrap dash">
      <header className="dash-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rx-eyebrow">{dateLine}</div>
          <h1 className="rx-h1">{t('dashboard.welcome_back')}</h1>
        </div>
        {/* Both plans run at once, so the hero shows one at a time rather than
            stacking two or quietly hiding the second. */}
        {planSchedules.length > 1 && (
          <div className="dash-plan-step">
            <button
              type="button"
              aria-label={t('dashboard.previous_plan')}
              onClick={() => setPlanIndex(i => (i - 1 + planSchedules.length) % planSchedules.length)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label={t('dashboard.next_plan')}
              onClick={() => setPlanIndex(i => (i + 1) % planSchedules.length)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </header>

      {todaySchedule && !isRestDay && todaySchedule.workout ? (
        <section className="dash-today">
          <div className="dash-today-media">
            {heroImage ? (
              <img src={heroImage} alt="" />
            ) : (
              <div className="dash-today-noimg" />
            )}
            <span className="dash-today-pill">{t('dashboard.todays_workout')}</span>
            {workoutDone && (
              <div className="dash-today-done">
                <span><Check size={18} /> {t('dashboard.workout_finished')}</span>
              </div>
            )}
          </div>

          <div className="dash-today-body">
            <div className="dash-today-meta">
              {/* The Dashboard mock uses a soft tint pill here, not the solid
                  MAIN/EXTRA badge the plan cards use — the hero already says
                  which plan it is, so it doesn't need to shout. */}
              {selectedPlan && (
                <span className="dash-plan-pill">
                  {t(selectedPlan.slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')}
                </span>
              )}
              <span style={{ fontWeight: 600 }}>{planInfo?.name}</span>
            </div>

            <h2 className="dash-today-title">{stripExt(firstPendingVideo?.filename || '')}</h2>

            <div className="dash-today-actions">
              <button
                type="button"
                className={`rx-btn ${workoutDone ? '' : 'rx-btn--primary'}`}
                onClick={openWorkout}
              >
                {workoutDone ? <RotateCcw size={17} /> : <Play size={17} />}
                {workoutDone ? t('dashboard.review_workout') : t('dashboard.start_training')}
              </button>
              <button type="button" className="rx-btn" onClick={() => navigate('/calendar')}>
                {t('dashboard.full_plan')}
              </button>
            </div>

            {planInfo && (
              <div className="dash-today-progress">
                <div className="dash-today-progress-row">
                  <span style={{ fontWeight: 600 }}>
                    {t('dashboard.plan_progress', {
                      completed: planInfo.completedWorkouts,
                      total: planInfo.totalWorkouts,
                    })}
                  </span>
                  <span className="rx-muted">
                    {planStatus === 'ended'
                      ? t('dashboard.plan_finished')
                      : planDaysLeft === 0
                        ? t('dashboard.plan_last_day')
                        : t('dashboard.plan_days_left', { count: planDaysLeft })}
                  </span>
                </div>
                <div className="rx-progress"><span style={{ width: `${planPct}%` }} /></div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="dash-today dash-today--rest">
          <div className="dash-today-body">
            <div className="rx-eyebrow">{t('dashboard.recharge')}</div>
            <h2 className="dash-today-title">{t('dashboard.rest_recovery')}</h2>
            <p className="rx-muted" style={{ margin: 0 }}>{t('dashboard.rest_msg')}</p>
          </div>
        </section>
      )}

      <div className="dash-cols">
        <section>
          <div className="dash-section-head">
            <h3 className="rx-section-title">{t('dashboard.upcoming')}</h3>
            <button type="button" className="rx-link" onClick={() => navigate('/calendar')}>
              {t('dashboard.view_calendar')}
            </button>
          </div>
          <div className="rx-card dash-upcoming">
            {upcomingWorkouts.length === 0 ? (
              <p className="dash-empty rx-muted">{t('dashboard.no_upcoming')}</p>
            ) : (
              upcomingWorkouts.map(day => {
                const first = day.workout?.videos[0];
                const date = new Date(day.date);
                return (
                  <button
                    type="button"
                    key={day.date}
                    className="dash-up-row"
                    onClick={() => first && day.workout && navigate(`/player/${first.id}/${day.workout.id}`)}
                  >
                    <span className="dash-up-date">
                      <span className="dash-up-dow">
                        {date.toLocaleDateString(i18n.language, { weekday: 'short' }).toUpperCase()}
                      </span>
                      <span className="dash-up-day">{date.getDate()}</span>
                    </span>
                    {first?.thumbnail
                      ? <img className="dash-up-thumb" src={thumbUrl(first.thumbnail)!} alt="" loading="lazy" />
                      : <span className="dash-up-thumb" />}
                    <span className="dash-up-text">
                      <span className="dash-up-title rx-clamp-2">{stripExt(first?.filename || day.workout?.name || '')}</span>
                      <span className="dash-up-meta rx-muted">{planInfo?.name}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section>
          <div className="dash-section-head">
            <h3 className="rx-section-title">{t('dashboard.your_collection')}</h3>
            <button type="button" className="rx-link" onClick={() => navigate('/library')}>
              {t('nav.library')}
            </button>
          </div>
          {/* A grid on desktop; on mobile it becomes a strip that bleeds to the
              page edges, so a fifth album is visibly cut off rather than hidden. */}
          <div className="dash-collection">
            {libraryPreview.map(album => (
              <button
                type="button"
                key={album.key}
                className="dash-album"
                onClick={() => navigate(`/library/${toAlbumRouteParam(album.key)}`)}
              >
                {album.cover
                  ? <img src={album.cover} alt="" loading="lazy" />
                  : <span className="dash-album-noimg" />}
                <span className="dash-album-name">{album.title}</span>
                <span className="dash-album-count rx-muted">
                  {t('dashboard.album_videos', { count: album.count })}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
