import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import EquipmentPicker from '../components/EquipmentPicker';
import { EquipmentIcon } from '../lib/equipment';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, BODY_PARTS, INTENSITIES, TRAINING_TYPES } from '../lib/metadata';
import { matchesTags, matchesQuery, matchesSource, useFilterMatchMode, FilterMatchToggle, SourceFilter, SourceFilterToggle } from '../lib/filters';
import { useMetaLabels } from '../lib/labels';
import { ImportResult, useImportAvailable } from '../lib/externalImport';
import { BuilderDay, BuilderWeek, createWeek, createInitialBuilderWeeks } from '../lib/builderModel';
import { useAiAvailable } from '../lib/useAiAvailable';
import YouTubeImportModal from '../components/YouTubeImportModal';
import AiPlanModal, { AiPlanResult } from '../components/ai/AiPlanModal';
import VideoTagChips from '../components/VideoTagChips';
import WorkoutPatternPicker, { DEFAULT_PATTERN } from '../components/WorkoutPatternPicker';
import { localDateString } from '../lib/dates';
import { Video } from '../types/video';

/**
 * Two plans can run at once, each in its own slot: the main plan and an
 * optional extra alongside it. The slot is stored in `is_active`
 * (0 = inactive, 1 = main, 2 = extra).
 */
type Slot = 'main' | 'extra';
const ACTIVE_MAIN = 1;
const ACTIVE_EXTRA = 2;

const slotOf = (plan: Plan): Slot | null =>
  plan.is_active === ACTIVE_MAIN ? 'main' : plan.is_active === ACTIVE_EXTRA ? 'extra' : null;

interface Plan {
  id: string;
  name: string;
  uploaded_at: string;
  /** 0 = inactive, 1 = main plan, 2 = extra plan. */
  is_active: number;
  start_date: string;
  /** The user's own note about the plan. Shown on the card and in details. */
  description?: string | null;
  /** This plan's workout/rest cycle. Null means it follows the global one. */
  workout_pattern?: string | null;
  background_image?: string | null;
  background_blur?: number;
  workout_count?: number;
  equipment?: string[];
  category?: string | null;
  /** True when the plan contains videos that stream instead of playing offline. */
  has_external?: boolean;
}

/** A video resolved by `GET /api/plan/:id`. */
type PlanVideo = Video;

/** One workout day of a plan, with its videos already resolved. */
interface PlanDay {
  id: string;
  name: string;
  sequence_order: number;
  videos: PlanVideo[];
}

const API_BASE = '';

const resolveBackgroundUrl = (backgroundImage?: string | null) => {
  if (!backgroundImage) return null;
  return backgroundImage.startsWith('http') ? backgroundImage : `${API_BASE}${backgroundImage}`;
};

// Preset plan categories. Stored as these keys so the label follows the UI
// language; anything else in `category` is a custom label shown verbatim.
const PLAN_CATEGORIES = ['reduction', 'strength', 'cardio', 'mobility', 'endurance', 'flexibility'] as const;
type PlanCategory = typeof PLAN_CATEGORIES[number];

const isPresetCategory = (value: string): boolean =>
  (PLAN_CATEGORIES as readonly string[]).includes(value);

/** Stable key for the uncategorized group in collapse state / localStorage. */
const UNCATEGORIZED_KEY = '__uncategorized';
const COLLAPSED_CATEGORIES_KEY = 'plansCollapsedCategories';

function readCollapsedCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_CATEGORIES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((key): key is string => typeof key === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function categoryStorageKey(key: string): string {
  return key || UNCATEGORIZED_KEY;
}

// Display-only: the extension is noise when browsing for videos to add.
const stripVideoExt = (filename: string) => filename.replace(/\.[^/.]+$/, '');

/** A plan's stored rhythm, or null when it follows the global one. */
function parsePlanPattern(raw?: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const days = parsed.map((value: unknown) => (value ? 1 : 0));
    return days.some(day => day === 1) ? days : null;
  } catch {
    return null;
  }
}

// "1:04:20" for long videos, "32:15" otherwise — the usual player convention.
function formatRuntime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * One workout day in the plan details view.
 *
 * Deliberately the same shape as a calendar day card: a preview with the
 * slider arrows when the day holds more than one video, so browsing a plan
 * works the way browsing the schedule already does. It carries no dates,
 * completion state or playback — this view is a look at what's in the plan.
 */
function PlanDayCard({ day, index }: { day: PlanDay; index: number }) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);

  const videos = day.videos;
  const current = videos[Math.min(currentIndex, Math.max(videos.length - 1, 0))];

  const step = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex(prev => (prev + delta + videos.length) % videos.length);
  };

  return (
    <div className="plan-day-card">
      <div className="plan-day-thumb">
        {current?.thumbnail_path ? (
          <img src={`/thumbnails/${current.thumbnail_path}`} alt={current.filename} />
        ) : (
          <span className="plan-day-noimg">{t('calendar.no_preview')}</span>
        )}

        <span className="plan-day-badge">{t('plans.details_day_n', { n: index + 1 })}</span>

        {current?.duration_seconds ? (
          <span className="plan-day-runtime">{formatRuntime(current.duration_seconds)}</span>
        ) : null}

        {videos.length > 1 && (
          <>
            <button
              type="button"
              className="slider-nav-btn"
              style={{ left: '8px' }}
              aria-label={t('plans.scroll_prev')}
              onClick={step(-1)}
            >
              <span>‹</span>
            </button>
            <button
              type="button"
              className="slider-nav-btn"
              style={{ right: '8px' }}
              aria-label={t('plans.scroll_next')}
              onClick={step(1)}
            >
              <span>›</span>
            </button>
            <span className="plan-day-counter">
              {Math.min(currentIndex, videos.length - 1) + 1} / {videos.length}
            </span>
          </>
        )}
      </div>

      <span className="plan-day-video-name" title={current?.filename}>
        {current ? stripVideoExt(current.filename) : ''}
      </span>

      {current && (
        <VideoTagChips
          className="plan-day-tags"
          intensity={current.intensity}
          trainingType={current.training_type}
          bodyParts={current.body_parts}
          equipment={current.equipment}
          max={3}
        />
      )}
    </div>
  );
}

export default function Plans() {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState('');
  const [activationDate, setActivationDate] = useState(localDateString());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(readCollapsedCategories);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [builderStep, setBuilderStep] = useState(1);
  const [planName, setPlanName] = useState('My Custom Plan');
  const [planDescription, setPlanDescription] = useState('');
  // The plan's own workout/rest cycle. Seeded from the global pattern in
  // Settings, which is what a plan follows until it is given one of its own.
  const [builderPattern, setBuilderPattern] = useState<number[]>(DEFAULT_PATTERN);
  const [globalPattern, setGlobalPattern] = useState<number[]>(DEFAULT_PATTERN);
  // False means "follow whatever Settings says", stored as no pattern at all —
  // so changing the global rhythm later still moves these plans with it. Only
  // an explicit override is saved onto the plan.
  const [builderPatternCustom, setBuilderPatternCustom] = useState(false);
  const [builderStartDate, setBuilderStartDate] = useState(localDateString());
  // Either a preset key, '' for none, or 'custom' while the free-text field is open.
  const [builderCategory, setBuilderCategory] = useState('');
  const [builderCustomCategory, setBuilderCustomCategory] = useState('');
  const [builderWeeks, setBuilderWeeks] = useState<BuilderWeek[]>(createInitialBuilderWeeks());
  const [builderCurrentWeek, setBuilderCurrentWeek] = useState(0);
  const [builderCurrentDay, setBuilderCurrentDay] = useState(0);
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [videoSearch, setVideoSearch] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string[]>([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string>('');
  const [selectedSource, setSelectedSource] = useState<SourceFilter>('');
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const [showBuilderFilters, setShowBuilderFilters] = useState(false);
  const [videoViewMode, setVideoViewMode] = useState<'grid' | 'list'>('grid');
  const [builderStatus, setBuilderStatus] = useState('');
  const [builderLoading, setBuilderLoading] = useState(false);

  // YouTube playlist import. Hidden entirely when the server reports no
  // resolver (see server/src/external/index.ts), checked only once the builder
  // is open so the Plans page costs nothing extra to load.
  const importAvailable = useImportAvailable(isBuilderOpen);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // IDs from the most recent import, so the builder can filter down to them.
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [showOnlyImported, setShowOnlyImported] = useState(false);

  // Optional AI plan drafting. Like the import above, the entry point is hidden
  // entirely unless the server reports a configured model (see server/src/ai/).
  // The AI modal only pre-fills this builder — it never saves a plan itself.
  const aiAvailable = useAiAvailable();
  const [isAiOpen, setIsAiOpen] = useState(false);

  // Horizontal scroller holding the active plans, and whether either arrow has
  // anywhere left to go. The scrollbar itself is hidden, so the arrows are the
  // only affordance and have to reflect the real scroll position.
  const featuredRowRef = useRef<HTMLDivElement | null>(null);
  const [featuredCanScrollPrev, setFeaturedCanScrollPrev] = useState(false);
  const [featuredCanScrollNext, setFeaturedCanScrollNext] = useState(false);

  // Plan details modal, opened by clicking a plan card (rather than one of the
  // buttons on it). Loads the plan's videos lazily, one plan at a time.
  const [detailsPlanId, setDetailsPlanId] = useState<string | null>(null);
  const [detailsDays, setDetailsDays] = useState<PlanDay[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Background image picker state (scoped per-plan)
  const [bgPickerPlanId, setBgPickerPlanId] = useState<string | null>(null);
  const [bgPickerTab, setBgPickerTab] = useState<'thumbnail' | 'upload'>('thumbnail');
  const [bgUploading, setBgUploading] = useState(false);
  const [bgPickerVideos, setBgPickerVideos] = useState<Video[]>([]);
  const [bgPickerLoading, setBgPickerLoading] = useState(false);

  const fetchPlans = async () => {
    const res = await fetch('/api/plan');
    const data = await res.json();
    setPlans(data);
  };

  useEffect(() => {
    fetchPlans();
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data?.workout_pattern) && data.workout_pattern.some((d: number) => d)) {
          setGlobalPattern(data.workout_pattern);
          // Seeds the builder too. This runs once at mount, before any builder
          // can be open, so it can't overwrite a rhythm the user is editing.
          setBuilderPattern(data.workout_pattern);
        }
      })
      .catch(() => { /* keep the built-in default */ });
  }, []);

  const handleFileUpload = async (selectedFile: File) => {
    setStatus(t('plans.uploading_status'));
    const formData = new FormData();
    formData.append('file', selectedFile);

    const res = await fetch('/api/plan/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) {
      setStatus(`Error: ${data.error}`);
    } else {
      setStatus(t('plans.uploaded_status', { count: data.workoutCount }));
      fetchPlans();
    }
  };

  const handleActivate = async (id: string, slot: Slot) => {
    setStatus(t('plans.activating_status'));
    const res = await fetch(`/api/plan/activate/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: activationDate, slot })
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t(slot === 'extra' ? 'plans.activated_extra_status' : 'plans.activated_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_activate'));
    }
  };

  const handleDuplicate = async (id: string) => {
    const plan = plans.find(p => p.id === id);
    setStatus(t('plans.duplicating_status'));
    const res = await fetch(`/api/plan/${id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Named here rather than server-side so the suffix follows the UI language.
      body: JSON.stringify({ name: t('plans.copy_of', { name: plan?.name ?? '' }) }),
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.duplicated_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_duplicate'));
    }
  };

  // Frees a slot without touching the plan itself.
  const handleDeactivate = async (id: string) => {
    const res = await fetch(`/api/plan/deactivate/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.deactivated_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_activate'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('plans.delete_confirm'))) return;
    setStatus(t('plans.deleting_status'));
    const res = await fetch(`/api/plan/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.deleted_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_delete'));
    }
  };

  const handleEditPlan = async (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    try {
      const res = await fetch(`/api/plan/${planId}`);
      const planData = await res.json();

      // Reconstruct weeks from workouts based on sequence_order
      // Group workouts into weeks (7 days per week)
      const weeks: BuilderWeek[] = [];
      
      planData.workouts.forEach((workout: any) => {
        const sequenceOrder = workout.sequence_order || 0;
        const weekIndex = Math.floor(sequenceOrder / 7);
        const dayIndex = sequenceOrder % 7;

        // Ensure we have enough weeks
        while (weeks.length <= weekIndex) {
          weeks.push(createWeek(weeks.length + 1));
        }

        // Parse video IDs from the workout
        let videoIds = [];
        try {
          videoIds = JSON.parse(workout.video_ids || '[]');
        } catch (e) {
          videoIds = [];
        }

        // Set the video IDs for this day
        weeks[weekIndex].days[dayIndex].videoIds = videoIds;
      });

      // Use existing weeks or create a default one
      const finalWeeks = weeks.length > 0 ? weeks : createInitialBuilderWeeks();

      // Populate builder state
      setPlanName(plan.name);
      setPlanDescription(plan.description || '');
      const planPattern = parsePlanPattern(plan.workout_pattern);
      setBuilderPatternCustom(planPattern !== null);
      setBuilderPattern(planPattern || globalPattern);
      setBuilderStartDate(plan.start_date);
      const existingCategory = plan.category?.trim() || '';
      setBuilderCategory(
        existingCategory === '' ? '' : isPresetCategory(existingCategory) ? existingCategory : 'custom'
      );
      setBuilderCustomCategory(isPresetCategory(existingCategory) ? '' : existingCategory);
      setBuilderWeeks(finalWeeks);
      setBuilderCurrentWeek(0);
      setBuilderCurrentDay(0);
      setEditingPlanId(planId);
      setBuilderStep(2);
      setIsBuilderOpen(true);
    } catch (error) {
      console.error('Error loading plan for editing:', error);
      setStatus('Error loading plan for editing');
    }
  };

  /**
   * Hand an AI draft to the builder.
   *
   * Deliberately the same three calls the edit path above makes — the builder
   * has always been able to open onto pre-filled weeks, so a draft needs no new
   * machinery and nothing about the manual flow changes. `editingPlanId` stays
   * null so saving creates a new plan rather than overwriting the last one
   * edited.
   */
  const handleAiGenerated = (result: AiPlanResult) => {
    setIsAiOpen(false);
    setPlanName(result.name.trim() || t('ai.default_plan_name'));
    // The draft's summary describes the structure it chose, which is exactly
    // what the plan's description is for. Pre-filled, and editable like the rest.
    setPlanDescription(result.summary || '');
    // The draft was paced for this rhythm, so the plan should be saved with it.
    setBuilderPatternCustom(result.workoutPattern !== null);
    setBuilderPattern(result.workoutPattern || globalPattern);
    setBuilderStartDate(localDateString());
    setBuilderCategory('');
    setBuilderCustomCategory('');
    setBuilderWeeks(result.weeks);
    setBuilderCurrentWeek(0);
    setBuilderCurrentDay(0);
    setEditingPlanId(null);
    setBuilderStep(2);
    setIsBuilderOpen(true);

    // The user reviews and edits before saving, so anything the draft couldn't
    // honour is said out loud here rather than discovered later.
    const notes = [result.summary];
    if (result.workoutDayCount > 0 && result.workoutDayCount < result.requestedWorkoutDays) {
      notes.push(t('ai.short_notice', {
        count: result.workoutDayCount,
        requested: result.requestedWorkoutDays,
      }));
    }
    if (result.droppedIds.length > 0) {
      notes.push(t('ai.dropped_notice', { count: result.droppedIds.length }));
    }
    if (result.truncated) {
      notes.push(t('ai.truncated_notice', { count: result.candidateCount }));
    }
    setBuilderStatus(notes.filter(Boolean).join(' '));
  };

  useEffect(() => {
    if (!isBuilderOpen || allVideos.length > 0) return;
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setAllVideos(data || []))
      .catch(() => setAllVideos([]));
  }, [isBuilderOpen, allVideos.length]);

  const handleImported = (result: ImportResult) => {
    const imported = result.videos || [];
    // Imported videos are ordinary library rows now, so merge them into the
    // same list the builder already renders rather than tracking them apart.
    setAllVideos(prev => {
      const byId = new Map(prev.map(v => [v.id, v]));
      for (const v of imported) byId.set(v.id, v);
      return Array.from(byId.values());
    });
    setImportedIds(imported.map(v => v.id));
    setShowOnlyImported(true);
    setIsImportOpen(false);
    setBuilderStatus(
      result.truncated
        ? t('import.done_truncated', { count: result.totalCount })
        : t('import.done', { count: result.totalCount })
    );
  };

  const toggleVideoForDay = (videoId: string) => {
    setBuilderWeeks(prev => {
      return prev.map((week, wIndex) => {
        if (wIndex !== builderCurrentWeek) return week;
        return {
          ...week,
          days: week.days.map((day, dIndex) => {
            if (dIndex !== builderCurrentDay) return day;
            const alreadySelected = day.videoIds.includes(videoId);
            return {
              ...day,
              videoIds: alreadySelected ? day.videoIds.filter(id => id !== videoId) : [...day.videoIds, videoId]
            };
          })
        };
      });
    });
  };

  const removeVideoFromDay = (weekIndex: number, dayIndex: number, videoId: string) => {
    setBuilderWeeks(prev => prev.map((week, wIndex) => {
      if (wIndex !== weekIndex) return week;
      return {
        ...week,
        days: week.days.map((day, dIndex) => {
          if (dIndex !== dayIndex) return day;
          return {
            ...day,
            videoIds: day.videoIds.filter(id => id !== videoId)
          };
        })
      };
    }));
  };

  const handleSaveBuilderPlan = async () => {
    const selectedDays = builderWeeks.flatMap((week, wIndex) =>
      week.days.map((day, dIndex) => {
        // Include video filenames in the day name (no week-day heading)
        const videoTitles = day.videoIds.map(videoId => {
          const video = allVideos.find(v => v.id === videoId);
          return video ? video.filename : '';
        }).filter(Boolean);

        // Just use video titles, without the week-day heading
        // The sequence_order in the database encodes the week/day structure
        const dayName = videoTitles.length > 0
          ? videoTitles.join('\n')
          : '';

        return {
          ...day,
          name: dayName,
          videoTitles
        };
      })
    ).filter(day => day.videoIds.length > 0);

    if (!selectedDays.length) {
      setBuilderStatus(t('plans.builder_need_videos'));
      return;
    }

    setBuilderLoading(true);
    setBuilderStatus(t('plans.builder_saving'));

    const endpoint = editingPlanId 
      ? `/api/plan/${editingPlanId}`
      : '/api/plan/create';

    const res = await fetch(endpoint, {
      method: editingPlanId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: planName,
        startDate: builderStartDate,
        category: resolvedBuilderCategory(),
        description: planDescription,
        workoutPattern: builderPatternCustom ? builderPattern : null,
        days: selectedDays
      })
    });
    const data = await res.json();
    setBuilderLoading(false);

    if (data.error) {
      setBuilderStatus(`Error: ${data.error}`);
    } else {
      setBuilderStatus('');
      setIsBuilderOpen(false);
      setEditingPlanId(null);
      setBuilderStep(1);
      setPlanDescription('');
      setBuilderPattern(globalPattern);
      setBuilderPatternCustom(false);
      setBuilderCategory('');
      setBuilderCustomCategory('');
      setBuilderWeeks(createInitialBuilderWeeks());
      setBuilderCurrentWeek(0);
      setBuilderCurrentDay(0);
      setVideoSearch('');
      setStatus(t('plans.builder_saved', { count: selectedDays.length }));
      fetchPlans();
    }
  };

  const renameWeeksAfterDeletion = (weeks: BuilderWeek[]) => {
    return weeks.map((week, index) => ({
      ...week,
      name: `Week ${index + 1}`
    }));
  };

  // Advance to the next day. Rolls over to the next week's first day at the end
  // of a week, creating that week automatically when it doesn't exist yet.
  const goToNextDay = () => {
    const week = builderWeeks[builderCurrentWeek];
    if (!week) return;
    if (builderCurrentDay < week.days.length - 1) {
      setBuilderCurrentDay(builderCurrentDay + 1);
      return;
    }
    if (builderCurrentWeek < builderWeeks.length - 1) {
      setBuilderCurrentWeek(builderCurrentWeek + 1);
      setBuilderCurrentDay(0);
      return;
    }
    setBuilderWeeks(prev => [...prev, createWeek(prev.length + 1)]);
    setBuilderCurrentWeek(builderCurrentWeek + 1);
    setBuilderCurrentDay(0);
  };

  // Mirror of goToNextDay. Rolls back into the previous week's last day, and
  // stops at the very first day rather than wrapping around.
  const goToPrevDay = () => {
    if (builderCurrentDay > 0) {
      setBuilderCurrentDay(builderCurrentDay - 1);
      return;
    }
    if (builderCurrentWeek > 0) {
      const prevWeek = builderWeeks[builderCurrentWeek - 1];
      setBuilderCurrentWeek(builderCurrentWeek - 1);
      setBuilderCurrentDay(Math.max((prevWeek?.days.length || 1) - 1, 0));
    }
  };

  const isFirstDay = builderCurrentWeek === 0 && builderCurrentDay === 0;

  // Week/day headings are derived from the position, not from the stored
  // BuilderWeek/BuilderDay `name` (which is an internal English placeholder and
  // gets replaced by the video titles on save), so they follow the UI language.
  const weekLabel = (index: number) => t('plans.builder_week_n', { n: index + 1 });
  const dayLabel = (index: number) => t('plans.builder_day_n', { n: index + 1 });

  // Renders a single day card. `pinned` cards live inside the sticky header
  // (the day currently being edited) and are not clickable to re-select.
  const renderDayCard = (day: BuilderDay, index: number, pinned = false) => {
    const isSelected = builderCurrentDay === index;
    return (
      <div
        key={index}
        className={`wb-day-card${isSelected ? ' selected' : ''}${pinned ? ' pinned' : ''}`}
        onClick={pinned ? undefined : () => setBuilderCurrentDay(index)}
      >
        <div className="wb-day-card-head">
          <span className="wb-day-name">
            {pinned && <span className="wb-day-badge">{t('plans.builder_currently_selected')}</span>}
            {dayLabel(index)}
          </span>
          {day.videoIds.length > 0 && (
            <span className="wb-day-count">{day.videoIds.length}</span>
          )}
        </div>
        {day.videoIds.length === 0 ? (
          <p className="wb-day-empty">{t('plans.builder_no_selected_videos')}</p>
        ) : (
          <div className="wb-day-videos">
            {day.videoIds.map(id => {
              const video = allVideos.find(v => v.id === id);
              return (
                <div key={id} className="wb-day-video">
                  <span className="wb-day-video-name">{video ? video.filename : id}</span>
                  <button type="button" className="wb-day-video-remove" onClick={(e) => { e.stopPropagation(); removeVideoFromDay(builderCurrentWeek, index, id); }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const closeBuilder = () => {
    setIsBuilderOpen(false);
    setEditingPlanId(null);
    setBuilderStep(1);
    setPlanDescription('');
    setBuilderPattern(globalPattern);
    setBuilderPatternCustom(false);
    setBuilderCategory('');
    setBuilderCustomCategory('');
    setBuilderWeeks(createInitialBuilderWeeks());
    setBuilderCurrentWeek(0);
    setBuilderCurrentDay(0);
    setBuilderStatus('');
    setVideoSearch('');
    setIsImportOpen(false);
    setImportedIds([]);
    setShowOnlyImported(false);
  };

  const builderVideos = allVideos.filter(video => {
    // After an import, default to showing just what was brought in — a 40-video
    // playlist is otherwise lost among the whole library.
    if (showOnlyImported && !importedIds.includes(video.id)) return false;

    const matchesText = matchesQuery([video.filename, video.description], videoSearch);

    const matchesEquipment = matchesTags(video.equipment, selectedEquipment, matchMode);
    const matchesTrainingType = matchesTags(video.training_type, selectedTrainingType, matchMode);
    const matchesIntensity = !selectedIntensity || video.intensity === selectedIntensity;
    const matchesBodyParts = matchesTags(video.body_parts, selectedBodyParts, matchMode);
    const matchesVideoSource = matchesSource(video, selectedSource);

    return matchesText && matchesEquipment && matchesTrainingType && matchesIntensity && matchesBodyParts && matchesVideoSource;
  });

  const currentWeek = builderWeeks[builderCurrentWeek];
  const currentDay = currentWeek?.days[builderCurrentDay] || currentWeek?.days[0];

  // The plan's contents, already resolved by the server: `days` for the
  // day-by-day details view, `videos` (de-duplicated) for the background picker.
  const fetchPlanContents = async (planId: string): Promise<{ days: PlanDay[]; videos: PlanVideo[] }> => {
    const res = await fetch(`/api/plan/${planId}`);
    const planData = await res.json();
    return { days: planData.days || [], videos: planData.videos || [] };
  };

  // Opens the read-only details view for a plan.
  const openPlanDetails = async (planId: string) => {
    setDetailsPlanId(planId);
    setDetailsDays([]);
    setDetailsLoading(true);
    try {
      const { days } = await fetchPlanContents(planId);
      setDetailsDays(days);
    } catch (error) {
      console.error('Error loading plan details:', error);
      setDetailsDays([]);
    }
    setDetailsLoading(false);
  };

  const closePlanDetails = () => {
    setDetailsPlanId(null);
    setDetailsDays([]);
  };

  // Opens the background picker for a specific plan, offering only the
  // videos that actually appear somewhere within that plan's workouts.
  const openBackgroundPicker = async (planId: string) => {
    setBgPickerPlanId(planId);
    setBgPickerTab('thumbnail');
    setBgPickerLoading(true);
    setBgPickerVideos([]);
    try {
      const { videos } = await fetchPlanContents(planId);
      setBgPickerVideos(videos.filter(v => v.thumbnail_path));
    } catch (error) {
      console.error('Error loading plan videos for background picker:', error);
      setBgPickerVideos([]);
    }
    setBgPickerLoading(false);
  };

  const closeBackgroundPicker = () => {
    setBgPickerPlanId(null);
    setBgPickerVideos([]);
  };

  const handleSelectThumbnailBackground = async (planId: string, thumbnailPath: string) => {
    const res = await fetch(`/api/plan/${planId}/background`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbnailPath })
    });
    const data = await res.json();
    if (data.success) {
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, background_image: data.backgroundImage } : p));
      closeBackgroundPicker();
    }
  };

  const handleUploadBackground = async (planId: string, imageFile: File) => {
    setBgUploading(true);
    const formData = new FormData();
    formData.append('file', imageFile);
    const res = await fetch(`/api/plan/${planId}/background`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    setBgUploading(false);
    if (data.success) {
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, background_image: data.backgroundImage } : p));
      closeBackgroundPicker();
    }
  };

  const handleClearBackground = async (planId: string) => {
    const res = await fetch(`/api/plan/${planId}/background`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, background_image: null } : p));
    }
  };

  const handleToggleBackgroundBlur = async (planId: string, blur: boolean) => {
    const res = await fetch(`/api/plan/${planId}/background-blur`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blur })
    });
    const data = await res.json();
    if (data.success) {
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, background_blur: data.backgroundBlur } : p));
    }
  };

  const bgPickerPlan = plans.find(p => p.id === bgPickerPlanId);
  const bgPickerCurrentUrl = resolveBackgroundUrl(bgPickerPlan?.background_image);

  const detailsPlan = plans.find(p => p.id === detailsPlanId) || null;

  // Active plans get their own featured cards above the grid of the remaining
  // plans — the main plan first, then the extra one when a second is active.
  const activePlans = plans.filter(p => slotOf(p) !== null);
  const otherPlans = plans.filter(p => slotOf(p) === null);

  const syncFeaturedArrows = () => {
    const row = featuredRowRef.current;
    if (!row) return;
    // A pixel of slack: fractional widths can leave a sub-pixel gap at the end.
    setFeaturedCanScrollPrev(row.scrollLeft > 1);
    setFeaturedCanScrollNext(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  };

  // Re-checked when the number of active plans changes (a plan was activated or
  // deactivated) and on resize, since either can change what fits.
  useEffect(() => {
    syncFeaturedArrows();
    window.addEventListener('resize', syncFeaturedArrows);
    return () => window.removeEventListener('resize', syncFeaturedArrows);
  }, [activePlans.length]);

  // Steps by one card, which is what the row is sized in. The arrows are also
  // re-synced once the smooth scroll has settled: `onScroll` normally covers
  // this, but resolving it here too means the arrows can't be left stale if the
  // scroll finishes without one.
  const scrollFeatured = (direction: -1 | 1) => {
    const row = featuredRowRef.current;
    if (!row) return;
    const card = row.firstElementChild as HTMLElement | null;
    const step = card ? card.getBoundingClientRect().width + 20 : row.clientWidth;
    row.scrollBy({ left: direction * step, behavior: 'smooth' });
    window.setTimeout(syncFeaturedArrows, 450);
  };

  // Remaining plans are grouped under category headings: known presets first (in
  // their canonical order), then custom labels A→Z, then uncategorized plans last.
  const planGroups = (() => {
    const byCategory = new Map<string, Plan[]>();
    for (const plan of otherPlans) {
      const key = plan.category?.trim() || '';
      const arr = byCategory.get(key) || [];
      arr.push(plan);
      byCategory.set(key, arr);
    }
    const keys = Array.from(byCategory.keys());
    const presets = keys.filter(k => isPresetCategory(k)).sort(
      (a, b) => PLAN_CATEGORIES.indexOf(a as PlanCategory) - PLAN_CATEGORIES.indexOf(b as PlanCategory)
    );
    const custom = keys.filter(k => k && !isPresetCategory(k)).sort((a, b) => a.localeCompare(b));
    const ordered = [...presets, ...custom, ...(byCategory.has('') ? [''] : [])];
    return ordered.map(key => ({ key, plans: byCategory.get(key) || [] }));
  })();

  // Only show headings once there is something to distinguish.
  const showCategoryHeadings = planGroups.some(g => g.key !== '');

  const toggleCategoryCollapsed = (key: string) => {
    const storageKey = categoryStorageKey(key);
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(storageKey)) next.delete(storageKey);
      else next.add(storageKey);
      try {
        localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify([...next]));
      } catch {
        /* localStorage unavailable — keep the choice in memory only */
      }
      return next;
    });
  };

  // Preset categories are translated; custom labels are shown exactly as typed.
  const categoryLabel = (key: string) =>
    isPresetCategory(key) ? t(`plans.category_${key}`) : key;

  // The value actually saved: a preset key, the typed custom label, or '' for none.
  const resolvedBuilderCategory = () =>
    builderCategory === 'custom' ? builderCustomCategory.trim() : builderCategory;

  // Plan note, offered wherever the category is — the two are the same kind of
  // "what is this plan" metadata and are easiest to fill in together.
  const renderDescriptionField = () => (
    <div className="wb-field">
      <label className="wb-label">{t('plans.builder_description')}</label>
      <textarea
        className="wb-input wb-textarea"
        value={planDescription}
        onChange={e => setPlanDescription(e.target.value)}
        placeholder={t('plans.builder_description_placeholder')}
        rows={3}
        maxLength={1000}
      />
      <p className="wb-hint">{t('plans.builder_description_hint')}</p>
    </div>
  );

  // The plan's own rhythm, shown wherever its name and start date are — the
  // three together are what turn an ordered list of workouts into dated days.
  const renderPatternField = () => (
    <div className="wb-field">
      <label className="wb-label">{t('plans.builder_pattern')}</label>
      <div className="wb-chip-row">
        <button
          type="button"
          className={`wb-chip${builderPatternCustom ? '' : ' selected'}`}
          onClick={() => { setBuilderPatternCustom(false); setBuilderPattern(globalPattern); }}
        >
          {t('plans.pattern_default')}
        </button>
        <button
          type="button"
          className={`wb-chip${builderPatternCustom ? ' selected' : ''}`}
          onClick={() => setBuilderPatternCustom(true)}
        >
          {t('plans.pattern_custom')}
        </button>
      </div>
      {/* Shown either way: when following the default you should still be able
          to see the rhythm you're accepting. */}
      <WorkoutPatternPicker
        pattern={builderPattern}
        onChange={setBuilderPattern}
        disabled={!builderPatternCustom}
      />
      <p className="wb-hint">
        {builderPatternCustom ? t('plans.pattern_own_note') : t('plans.pattern_following_note')}
      </p>
    </div>
  );

  // Category chooser used in both the create flow (step 1) and the edit form.
  const renderCategoryField = () => (
    <div className="wb-field">
      <label className="wb-label">{t('plans.builder_category')}</label>
      <div className="wb-chip-row">
        <button
          type="button"
          className={`wb-chip${builderCategory === '' ? ' selected' : ''}`}
          onClick={() => setBuilderCategory('')}
        >
          {t('plans.category_none')}
        </button>
        {PLAN_CATEGORIES.map(cat => (
          <button
            type="button"
            key={cat}
            className={`wb-chip${builderCategory === cat ? ' selected' : ''}`}
            onClick={() => setBuilderCategory(cat)}
          >
            {t(`plans.category_${cat}`)}
          </button>
        ))}
        <button
          type="button"
          className={`wb-chip${builderCategory === 'custom' ? ' selected' : ''}`}
          onClick={() => setBuilderCategory('custom')}
        >
          + {t('plans.category_custom')}
        </button>
      </div>
      {builderCategory === 'custom' && (
        <input
          className="wb-input"
          style={{ marginTop: 10 }}
          value={builderCustomCategory}
          onChange={e => setBuilderCustomCategory(e.target.value)}
          placeholder={t('plans.category_custom_placeholder')}
          maxLength={60}
        />
      )}
    </div>
  );

  // Warns that a plan can't be done offline because some of its videos stream.
  const renderOfflineWarning = (plan: Plan) => (
    plan.has_external ? (
      <span className="plan-offline-warning" title={t('plans.needs_internet_hint')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        {t('plans.needs_internet')}
      </span>
    ) : null
  );

  // Workout count + equipment tags, shared by the featured card and the grid cards.
  const renderPlanInfo = (plan: Plan) => (
    <div className="plan-card-info">
      <span className="plan-card-workouts">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11v11h-11z"/><path d="M6.5 2v4.5M17.5 2v4.5M6.5 17.5V22M17.5 17.5V22M2 6.5h4.5M2 17.5h4.5M17.5 6.5H22M17.5 17.5H22"/></svg>
        {t('plans.workout_count', { count: plan.workout_count ?? 0 })}
      </span>
      {renderOfflineWarning(plan)}
      {(plan.equipment || []).map(eq => (
        <span key={eq} className="plan-card-tag" title={labels.equipment(eq)}>
          <EquipmentIcon id={eq} size={13} />
          {labels.equipment(eq)}
        </span>
      ))}
    </div>
  );

  return (
    <div className="plans-container">
      <div className="glass-card plans-hero" style={{ marginBottom: '2rem' }}>
        <div className="plans-hero-top">
          <div className="plans-hero-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
          </div>
          <div>
            <h1 style={{ marginBottom: '0.35rem' }}>{t('plans.manage_plans')}</h1>
            <p style={{ margin: 0 }}>{t('plans.upload_msg')}</p>
          </div>
        </div>

        <div className="plans-upload-row">
          <label className="file-picker">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>{t('plans.upload_btn')}</span>
            <input
              type="file"
              accept=".csv, .tsv"
              onChange={e => {
                const selected = e.target.files?.[0];
                if (selected) handleFileUpload(selected);
                e.target.value = '';
              }}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn btn-secondary" onClick={() => setIsBuilderOpen(true)}>{t('plans.build_btn')}</button>
          {aiAvailable && (
            <button className="btn btn-secondary" onClick={() => setIsAiOpen(true)}>{t('ai.build_btn')}</button>
          )}
        </div>
      </div>

      {status && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '2rem', background: 'rgba(0, 255, 157, 0.1)', color: 'var(--accent-color)', textAlign: 'center' }}>
          {status}
        </div>
      )}

      {/* One active plan fills the row as before; two become a horizontal
          scroller where the main plan leads and the extra one peeks in. The
          scrollbar is hidden, so the arrows below are the visible affordance. */}
      <div className={`plans-featured-wrap${activePlans.length > 1 ? ' multi' : ''}`}>
      {activePlans.length > 1 && (
        <>
          <button
            type="button"
            className="plans-featured-nav prev"
            aria-label={t('plans.scroll_prev')}
            disabled={!featuredCanScrollPrev}
            onClick={() => scrollFeatured(-1)}
          >
            <span>‹</span>
          </button>
          <button
            type="button"
            className="plans-featured-nav next"
            aria-label={t('plans.scroll_next')}
            disabled={!featuredCanScrollNext}
            onClick={() => scrollFeatured(1)}
          >
            <span>›</span>
          </button>
        </>
      )}
      <div
        className={`plans-featured-row${activePlans.length > 1 ? ' multi' : ''}`}
        ref={featuredRowRef}
        onScroll={syncFeaturedArrows}
      >
      {activePlans.map(plan => {
        const slot = slotOf(plan) as Slot;
        return (
        <div
          key={plan.id}
          className="plan-featured"
          role="button"
          tabIndex={0}
          onClick={() => openPlanDetails(plan.id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPlanDetails(plan.id);
            }
          }}
        >
          {/* Full-bleed image with a dark scrim, so every label on top is white —
              readable in all themes regardless of the theme's accent lightness. */}
          {(() => {
            const bgUrl = resolveBackgroundUrl(plan.background_image);
            return bgUrl ? (
              <div className={`plan-card-bg${plan.background_blur ? ' blurred' : ''}`} style={{ backgroundImage: `url(${bgUrl})` }} />
            ) : (
              <>
                <div className="plan-card-bg no-image" />
                <div className="plan-card-logo" />
              </>
            );
          })()}
          <div className="plan-featured-scrim" />

          <button
            type="button"
            className="plan-card-bg-btn"
            title={t('plans.set_background') || 'Set background image'}
            onClick={e => { e.stopPropagation(); openBackgroundPicker(plan.id); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>

          <div className="plan-featured-content">
            <div className="plan-featured-main">
              <div className="plan-featured-eyebrow">
                <span className="plan-featured-active">
                  {t(slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')}
                </span>
                {plan.category && (
                  <span className="plan-featured-category">{categoryLabel(plan.category)}</span>
                )}
                {renderOfflineWarning(plan)}
              </div>
              <h2 className="plan-featured-title">{plan.name}</h2>
              {plan.description && (
                <p className="plan-featured-description" title={plan.description}>{plan.description}</p>
              )}
              <p className="plan-featured-date">
                <span>{t('plans.start_date')}</span>
                <strong>{plan.start_date}</strong>
              </p>
            </div>

            <div className="plan-featured-panel">
              <span className="plan-featured-count">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11v11h-11z"/><path d="M6.5 2v4.5M17.5 2v4.5M6.5 17.5V22M17.5 17.5V22M2 6.5h4.5M2 17.5h4.5M17.5 6.5H22M17.5 17.5H22"/></svg>
                {t('plans.workout_count', { count: plan.workout_count ?? 0 })}
              </span>

              {/* Always shown, even when empty: hiding the row made a plan whose
                  videos carry no equipment tags look identical to one that was
                  never checked. */}
              <div className="plan-featured-equipment">
                <span className="plan-featured-panel-label">{t('plans.builder_filter_equipment')}</span>
                {(plan.equipment || []).length > 0 ? (
                  <div className="plan-featured-tags">
                    {(plan.equipment || []).map(eq => (
                      <span key={eq} className="plan-featured-tag" title={labels.equipment(eq)}>
                        <EquipmentIcon id={eq} size={13} />
                        {labels.equipment(eq)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="plan-featured-equipment-none">{t('plans.equipment_none')}</span>
                )}
              </div>

              <div className="plan-card-actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn-ghost" onClick={() => handleEditPlan(plan.id)}>{t('plans.edit')}</button>
                <button className="btn btn-ghost" onClick={() => handleDeactivate(plan.id)}>{t('plans.deactivate')}</button>
                <button className="btn btn-danger-ghost" onClick={() => handleDelete(plan.id)}>{t('plans.delete')}</button>
              </div>
            </div>
          </div>
        </div>
        );
      })}
      </div>
      </div>

      {planGroups.map(group => {
        const storageKey = categoryStorageKey(group.key);
        const collapsed = showCategoryHeadings && collapsedCategories.has(storageKey);
        const headingLabel = group.key ? categoryLabel(group.key) : t('plans.category_none');
        return (
        <section key={storageKey} className={`plans-category${collapsed ? ' collapsed' : ''}`}>
          {showCategoryHeadings && (
            <button
              type="button"
              className="plans-category-heading"
              aria-expanded={!collapsed}
              onClick={() => toggleCategoryCollapsed(group.key)}
            >
              <span className={`plans-category-chevron${collapsed ? '' : ' open'}`} aria-hidden="true" />
              <span className="plans-category-heading-label">{headingLabel}</span>
              <span className="plans-category-count">{group.plans.length}</span>
            </button>
          )}
          {!collapsed && (
          <div className="plans-grid">
            {group.plans.map(plan => {
          const bgUrl = resolveBackgroundUrl(plan.background_image);
          return (
            <div
              key={plan.id}
              className="glass-card plan-card"
              role="button"
              tabIndex={0}
              onClick={() => openPlanDetails(plan.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPlanDetails(plan.id);
                }
              }}
            >
              {bgUrl ? (
                <div className={`plan-card-bg${plan.background_blur ? ' blurred' : ''}`} style={{ backgroundImage: `url(${bgUrl})` }} />
              ) : (
                <>
                  <div className="plan-card-bg no-image" />
                  <div className="plan-card-logo" />
                </>
              )}
              <div className="plan-card-overlay" />

              <button
                type="button"
                className="plan-card-bg-btn"
                title={t('plans.set_background') || 'Set background image'}
                onClick={e => { e.stopPropagation(); openBackgroundPicker(plan.id); }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </button>

              <div className="plan-card-body">
                <h3 className="plan-card-title">{plan.name}</h3>

                {renderPlanInfo(plan)}

                <div className="plan-card-datefield" onClick={e => e.stopPropagation()}>
                  <label>{t('plans.set_start_date')}</label>
                  <input
                    type="date"
                    value={activationDate}
                    onChange={e => setActivationDate(e.target.value)}
                  />
                </div>

                {/* Two slots to activate into, so a plan can run alongside the main one. */}
                <div className="plan-card-activate" onClick={e => e.stopPropagation()}>
                  <span className="plan-card-activate-label">{t('plans.activate_as')}</span>
                  <button className="btn btn-ghost" onClick={() => handleActivate(plan.id, 'main')}>{t('plans.slot_main')}</button>
                  <button className="btn btn-ghost" onClick={() => handleActivate(plan.id, 'extra')}>{t('plans.slot_extra')}</button>
                </div>

                <div className="plan-card-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost" onClick={() => handleEditPlan(plan.id)}>{t('plans.edit')}</button>
                  <button className="btn btn-danger-ghost" onClick={() => handleDelete(plan.id)}>{t('plans.delete')}</button>
                </div>
              </div>
            </div>
          );
            })}
          </div>
          )}
        </section>
        );
      })}

      {plans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>
          {t('plans.no_plans')}
        </div>
      )}

      {detailsPlan && createPortal(
        <div className="plan-details-overlay" onClick={closePlanDetails}>
          <div className="plan-details-panel" onClick={e => e.stopPropagation()}>
            {(() => {
              const bgUrl = resolveBackgroundUrl(detailsPlan.background_image);
              const slot = slotOf(detailsPlan);
              return (
                <div className="plan-details-header">
                  {bgUrl ? (
                    <div className={`plan-card-bg${detailsPlan.background_blur ? ' blurred' : ''}`} style={{ backgroundImage: `url(${bgUrl})` }} />
                  ) : (
                    <>
                      <div className="plan-card-bg no-image" />
                      <div className="plan-card-logo" />
                    </>
                  )}
                  <div className="plan-featured-scrim" />
                  <button type="button" className="plan-details-close" onClick={closePlanDetails} aria-label={t('plans.builder_cancel')}>✕</button>
                  <div className="plan-details-header-content">
                    <div className="plan-featured-eyebrow">
                      {slot && (
                        <span className="plan-featured-active">
                          {t(slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')}
                        </span>
                      )}
                      {detailsPlan.category && (
                        <span className="plan-featured-category">{categoryLabel(detailsPlan.category)}</span>
                      )}
                      {/* The offline warning lives in the info row below, next to
                          the workout count, so it isn't repeated here. */}
                    </div>
                    <h2 className="plan-featured-title">{detailsPlan.name}</h2>
                    <p className="plan-featured-date">
                      <span>{t('plans.start_date')}</span>
                      <strong>{detailsPlan.start_date}</strong>
                    </p>
                    {renderPlanInfo(detailsPlan)}
                    {detailsPlan.description && (
                      <p className="plan-details-description">{detailsPlan.description}</p>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="plan-details-body">
              <h3 className="plan-details-section-title">
                {t('plans.details_days')}
                {detailsDays.length > 0 && (
                  <span className="plan-details-video-count">{detailsDays.length}</span>
                )}
              </h3>

              {detailsLoading ? (
                <p style={{ color: 'var(--text-secondary)' }}>{t('plans.details_loading')}</p>
              ) : detailsDays.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>{t('plans.details_no_videos')}</p>
              ) : (
                <div className="plan-day-grid">
                  {detailsDays.map((day, index) => (
                    <PlanDayCard key={day.id} day={day} index={index} />
                  ))}
                </div>
              )}
            </div>

            {/* Everything you can do to a plan, in the view you opened to look at
                it — so inspecting and acting aren't two different trips. */}
            <div className="plan-details-actions">
              <label className="plan-details-date">
                <span>{t('plans.set_start_date')}</span>
                <input
                  type="date"
                  value={activationDate}
                  onChange={e => setActivationDate(e.target.value)}
                />
              </label>

              <div className="plan-details-action-buttons">
                {slotOf(detailsPlan) !== 'main' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => { handleActivate(detailsPlan.id, 'main'); closePlanDetails(); }}
                  >
                    {t('plans.activate_as')}: {t('plans.slot_main')}
                  </button>
                )}
                {slotOf(detailsPlan) !== 'extra' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => { handleActivate(detailsPlan.id, 'extra'); closePlanDetails(); }}
                  >
                    {t('plans.activate_as')}: {t('plans.slot_extra')}
                  </button>
                )}
                {slotOf(detailsPlan) !== null && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => { handleDeactivate(detailsPlan.id); closePlanDetails(); }}
                  >
                    {t('plans.deactivate')}
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => { closePlanDetails(); handleEditPlan(detailsPlan.id); }}
                >
                  {t('plans.edit')}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { handleDuplicate(detailsPlan.id); closePlanDetails(); }}
                >
                  {t('plans.duplicate')}
                </button>
                <button
                  className="btn btn-danger-ghost"
                  onClick={async () => { await handleDelete(detailsPlan.id); closePlanDetails(); }}
                >
                  {t('plans.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {bgPickerPlanId && createPortal(
        <div className="bg-picker-overlay" onClick={closeBackgroundPicker}>
          <div className="bg-picker-panel" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{t('plans.set_background') || 'Set background image'}</h3>
              <button className="btn" style={{ background: 'transparent', border: '1px solid var(--glass-border)', padding: '6px 12px' }} onClick={closeBackgroundPicker}>✕</button>
            </div>

            <div className="bg-picker-tabs">
              <button className={`btn ${bgPickerTab === 'thumbnail' ? '' : 'btn-secondary'}`} onClick={() => setBgPickerTab('thumbnail')}>{t('plans.choose_from_library') || 'Choose from this plan'}</button>
              <button className={`btn ${bgPickerTab === 'upload' ? '' : 'btn-secondary'}`} onClick={() => setBgPickerTab('upload')}>{t('plans.upload_image') || 'Upload image'}</button>
            </div>

            {bgPickerCurrentUrl && (
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={!!bgPickerPlan?.background_blur}
                    onChange={e => bgPickerPlanId && handleToggleBackgroundBlur(bgPickerPlanId, e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                  />
                  {t('plans.blur_background') || 'Blur background'}
                </label>
                <button className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => bgPickerPlanId && handleClearBackground(bgPickerPlanId)}>
                  {t('plans.remove_background') || 'Remove background image'}
                </button>
              </div>
            )}

            {bgPickerTab === 'thumbnail' ? (
              bgPickerLoading ? (
                <p style={{ color: 'var(--text-secondary)' }}>{t('plans.builder_saving')}</p>
              ) : bgPickerVideos.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>{t('plans.builder_no_videos')}</p>
              ) : (
                <div className="bg-picker-thumb-grid">
                  {bgPickerVideos.map(video => (
                    <div
                      key={video.id}
                      className="bg-picker-thumb"
                      title={video.filename}
                      onClick={() => bgPickerPlanId && handleSelectThumbnailBackground(bgPickerPlanId, video.thumbnail_path as string)}
                    >
                      <img src={`/thumbnails/${video.thumbnail_path}`} alt={video.filename} />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <label className="file-picker" style={{ justifyContent: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span>{bgUploading ? t('plans.builder_saving') : (t('plans.upload_image') || 'Upload image')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    disabled={bgUploading}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f && bgPickerPlanId) handleUploadBackground(bgPickerPlanId, f);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {isImportOpen && (
        <YouTubeImportModal onClose={() => setIsImportOpen(false)} onImported={handleImported} />
      )}

      {isBuilderOpen && createPortal(
        <div className="wb-overlay">
          <div className="wb-modal">
            <div className="wb-header">
              <div>
                <h2 className="wb-title">{editingPlanId ? 'Edit Plan' : t('plans.builder_title')}</h2>
                <p className="wb-subtitle">{t('plans.builder_intro')}</p>
                <p className="wb-subtitle wb-subtitle-sm">{t('plans.builder_note')}</p>
              </div>
              <button className="wb-close" onClick={closeBuilder}>✕</button>
            </div>

            {builderStep === 1 ? (
              <div className="wb-form">
                <div className="wb-field">
                  <label className="wb-label">{t('plans.builder_plan_name')}</label>
                  <input className="wb-input" value={planName} onChange={e => setPlanName(e.target.value)} placeholder={t('plans.builder_plan_name')} />
                </div>
                <div className="wb-field">
                  <label className="wb-label">{t('plans.builder_start_date')}</label>
                  <input className="wb-input" type="date" value={builderStartDate} onChange={e => setBuilderStartDate(e.target.value)} />
                </div>
                {renderPatternField()}
                {renderCategoryField()}
                {renderDescriptionField()}
                <div className="wb-actions">
                  <button className="wb-btn wb-btn-ghost" onClick={closeBuilder}>{t('plans.builder_cancel')}</button>
                  <button className="wb-btn wb-btn-primary" onClick={() => setBuilderStep(2)}>{t('plans.builder_next')}</button>
                </div>
              </div>
            ) : (
              <div className="wb-form">
                {editingPlanId && (
                  <>
                    <div className="wb-field">
                      <label className="wb-label">{t('plans.builder_plan_name')}</label>
                      <input
                        className="wb-input"
                        value={planName}
                        onChange={e => setPlanName(e.target.value)}
                        placeholder={t('plans.builder_plan_name')}
                      />
                    </div>
                    {renderPatternField()}
                    {renderCategoryField()}
                    {renderDescriptionField()}
                  </>
                )}
                <div className="wb-sticky-head">
                  <div className="wb-step-header">
                    <div>
                      <p className="wb-step-label">{t('plans.builder_step', { current: 2, total: 2 })}</p>
                      <div className="wb-step-title-row">
                        <h3 className="wb-step-title">{`${weekLabel(builderCurrentWeek)} - ${dayLabel(builderCurrentDay)}`}</h3>
                      </div>
                    </div>
                    <div className="wb-week-nav">
                      <button className="wb-btn wb-btn-primary" onClick={() => setBuilderStep(1)}>{t('plans.builder_back')}</button>
                      <button className="wb-btn wb-btn-primary" onClick={() => setBuilderCurrentWeek(Math.max(builderCurrentWeek - 1, 0))} disabled={builderCurrentWeek === 0}>{t('plans.builder_prev_week')}</button>
                      <button className="wb-btn wb-btn-primary" onClick={() => setBuilderCurrentWeek(Math.min(builderCurrentWeek + 1, builderWeeks.length - 1))} disabled={builderCurrentWeek === builderWeeks.length - 1}>{t('plans.builder_next_week')}</button>
                      <button className="wb-btn wb-btn-primary" onClick={() => setBuilderWeeks(prev => [...prev, createWeek(prev.length + 1)])}>{t('plans.builder_add_week')}</button>
                      {builderWeeks.length > 1 && (
                        <button className="wb-btn wb-btn-danger" onClick={() => {
                          const newWeeks = renameWeeksAfterDeletion(
                            builderWeeks.filter((_, i) => i !== builderCurrentWeek)
                          );
                          setBuilderWeeks(newWeeks);
                          setBuilderCurrentWeek(Math.min(builderCurrentWeek, newWeeks.length - 1));
                        }}>{t('plans.builder_remove_week')}</button>
                      )}
                    </div>
                  </div>

                  <div className="wb-save-row">
                    <button className="wb-btn wb-btn-primary wb-btn-block" onClick={handleSaveBuilderPlan} disabled={builderLoading || !builderWeeks.some(week => week.days.some(day => day.videoIds.length > 0))}>{builderLoading ? t('plans.builder_saving') : t('plans.builder_save')}</button>
                  </div>
                  {builderStatus && (
                    <div className="wb-status">{builderStatus}</div>
                  )}
                  {currentDay && renderDayCard(currentDay, builderCurrentDay, true)}

                  {/* Directly under the day being edited, where the eye already
                      is after adding videos. Text-style so they don't compete
                      with the solid buttons in the row above. */}
                  <div className="wb-day-nav">
                    <button
                      type="button"
                      className="wb-day-nav-btn"
                      onClick={goToPrevDay}
                      disabled={isFirstDay}
                    >
                      ← {t('plans.builder_prev_day')}
                    </button>
                    <button type="button" className="wb-day-nav-btn" onClick={goToNextDay}>
                      {t('plans.builder_next_day')} →
                    </button>
                  </div>
                </div>

                {currentWeek.days.length > 1 && (
                  <div className="wb-day-list">
                    <p className="wb-day-list-label">{t('plans.builder_switch_day')}</p>
                    {/* The selected day is pinned in the sticky header, so in this
                        list its slot becomes a marker — it keeps the days before and
                        after visually separated and moves as the selection changes. */}
                    {currentWeek.days.map((day, index) => (
                      builderCurrentDay === index ? (
                        <div key={`current-${index}`} className="wb-day-marker">
                          <span className="wb-day-marker-line" />
                          <span className="wb-day-marker-label">{dayLabel(index)} — {t('plans.builder_currently_selected')}</span>
                          <span className="wb-day-marker-line" />
                        </div>
                      ) : renderDayCard(day, index)
                    ))}
                  </div>
                )}

                <div className="wb-lower">
                  <div className="wb-search-block">
                  <div className="wb-search-row">
                    <label className="wb-label">{t('plans.builder_search')}</label>
                    <div className="wb-search-controls">
                      <input className="wb-input wb-search-input" value={videoSearch} onChange={e => setVideoSearch(e.target.value)} placeholder={t('plans.builder_search')} />
                      <button type="button" className="wb-btn wb-btn-primary wb-btn-min" onClick={() => setShowBuilderFilters(prev => !prev)}>{t('plans.builder_filters')}</button>
                      <button type="button" className="wb-btn wb-btn-primary wb-btn-min" onClick={() => setVideoViewMode(prev => prev === 'grid' ? 'list' : 'grid')}>{videoViewMode === 'grid' ? t('plans.builder_list_view') : t('plans.builder_grid_view')}</button>
                      {importAvailable && (
                        <button
                          type="button"
                          className="wb-btn wb-btn-primary wb-btn-min"
                          onClick={() => setIsImportOpen(true)}
                        >
                          {t('import.btn')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Shown only after an import, so the list can be narrowed to
                      the new videos or widened back to the whole library. */}
                  {importedIds.length > 0 && (
                    <div className="wb-import-scope">
                      <label>
                        <input
                          type="checkbox"
                          checked={showOnlyImported}
                          onChange={e => setShowOnlyImported(e.target.checked)}
                        />
                        {t('import.show_only', { count: importedIds.length })}
                      </label>
                    </div>
                  )}

                  {showBuilderFilters && (
                    <div className="wb-filters">
                      <div className="wb-filter-group">
                        <div className="wb-filter-head">
                          <p className="wb-filter-title">{t('plans.builder_filter_equipment')}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <SourceFilterToggle
                              value={selectedSource}
                              onChange={setSelectedSource}
                              allLabel={t('library.source_all')}
                              localLabel={t('library.source_local')}
                              externalLabel={t('library.source_external')}
                            />
                            <FilterMatchToggle
                              mode={matchMode}
                              onChange={setMatchMode}
                              label={t('plans.builder_match_label')}
                              anyLabel={t('plans.builder_match_any')}
                              allLabel={t('plans.builder_match_all')}
                              anyHint={t('plans.builder_match_any_hint')}
                              allHint={t('plans.builder_match_all_hint')}
                            />
                            <button type="button" className="wb-btn wb-btn-primary wb-btn-sm" onClick={() => {
                              setSelectedEquipment([]);
                              setSelectedTrainingType([]);
                              setSelectedIntensity('');
                              setSelectedBodyParts([]);
                              setSelectedSource('');
                            }}>{t('plans.builder_clear_filters')}</button>
                          </div>
                        </div>
                        <EquipmentPicker selected={selectedEquipment} onChange={setSelectedEquipment} />
                      </div>
                      <div className="wb-filter-cols">
                        <div className="wb-filter-group">
                          <p className="wb-filter-title">{t('plans.builder_training_type')}</p>
                          <div className="wb-chip-row">
                            {TRAINING_TYPES.map(type => {
                              const selected = selectedTrainingType.includes(type);
                              return (
                                <button type="button" key={type} className={`wb-chip${selected ? ' selected' : ''}`} onClick={() => setSelectedTrainingType(prev => prev.includes(type) ? prev.filter(item => item !== type) : [...prev, type])}>
                                  <TrainingTypeIcon type={type} />
                                  <span>{labels.trainingType(type)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="wb-filter-group">
                          <p className="wb-filter-title">{t('plans.builder_intensity')}</p>
                          <div className="wb-chip-row">
                            {INTENSITIES.map(level => {
                              const selected = selectedIntensity === level;
                              return (
                                <button type="button" key={level} className={`wb-chip${selected ? ' selected' : ''}`} onClick={() => setSelectedIntensity(selected ? '' : level)}>
                                  <IntensityIcon level={level} />
                                  <span style={{ textTransform: 'capitalize' }}>{labels.intensity(level)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="wb-filter-group">
                          <p className="wb-filter-title">{t('plans.builder_body_parts')}</p>
                          <div className="wb-chip-row">
                            {BODY_PARTS.map(part => {
                              const selected = selectedBodyParts.includes(part);
                              return (
                                <button type="button" key={part} className={`wb-chip${selected ? ' selected' : ''}`} onClick={() => setSelectedBodyParts(prev => prev.includes(part) ? prev.filter(item => item !== part) : [...prev, part])}>
                                  <BodyPartIcon part={part} />
                                  <span>{labels.bodyPart(part)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`wb-videos ${videoViewMode === 'grid' ? 'grid' : 'list'}`}>
                  {builderVideos.length === 0 ? (
                    <p className="wb-empty">{t('plans.builder_no_videos')}</p>
                  ) : (
                    builderVideos.map(video => {
                      const selected = currentDay.videoIds.includes(video.id);
                      return (
                        <button key={video.id} type="button" className={`wb-video-card${selected ? ' selected' : ''}`} title={video.filename} onClick={() => toggleVideoForDay(video.id)}>
                          {videoViewMode === 'grid' ? (
                            <>
                              <span className="wb-video-thumb-wrap">
                                {video.thumbnail_path ? (
                                  <img className="wb-video-thumb" src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
                                ) : (
                                  <span className="wb-video-thumb wb-video-thumb-empty">—</span>
                                )}
                                <span className="wb-video-check">{selected ? '✓' : '+'}</span>
                              </span>
                              <span className="wb-video-name">{stripVideoExt(video.filename)}</span>
                            </>
                          ) : (
                            <>
                              <span className="wb-video-name">{stripVideoExt(video.filename)}</span>
                              <span className="wb-video-check">{selected ? '✓' : '+'}</span>
                            </>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Renders its own portal; only mounted once the server reports a
          configured model, so this whole branch is inert by default. */}
      <AiPlanModal
        open={isAiOpen}
        onClose={() => setIsAiOpen(false)}
        onGenerated={handleAiGenerated}
      />
    </div>
  );
}
