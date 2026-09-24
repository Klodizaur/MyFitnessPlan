import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, HardDriveUpload, ListPlus, Plus, Search, Sparkles } from 'lucide-react';
import { useMetaLabels } from '../lib/labels';
import { ImportResult, useImportAvailable } from '../lib/externalImport';
import { BuilderWeek, createWeek, createInitialBuilderWeeks, workoutSlots } from '../lib/builderModel';
import { useAiAvailable } from '../lib/useAiAvailable';
import YouTubeImportModal from '../components/YouTubeImportModal';
import AiPlanModal, { AiPlanResult } from '../components/ai/AiPlanModal';
import { DEFAULT_PATTERN } from '../components/WorkoutPatternPicker';
import PlanBuilderScreen from '../components/builder/PlanBuilderScreen';
import ExportPlanModal from '../components/ExportPlanModal';
import ImportPlanModal from '../components/ImportPlanModal';
import FreezePlanModal from '../components/FreezePlanModal';
import { FreezeReason } from '../lib/freeze';
import { localDateString, useToday } from '../lib/dates';
import { confirmDialog } from '../lib/confirm';
import { ActivePlanCard, EmptySlot, PlanCard, PlanCardData } from '../components/plans/PlanCards';
import StartPlanSheet, { Slot } from '../components/plans/StartPlanSheet';
import PlanPreviewModal from '../components/plans/PlanPreviewModal';
import CoverPickerModal from '../components/plans/CoverPickerModal';
import CreateSheet from '../components/plans/CreateSheet';
import ImportMenu from '../components/plans/ImportMenu';
import '../styles/plans.css';
import { Video } from '../types/video';

/**
 * Two plans can run at once, each in its own slot: the main plan and an
 * optional extra alongside it. The slot is stored in `is_active`
 * (0 = inactive, 1 = main, 2 = extra). `Slot` itself lives with the start sheet.
 */
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
  is_favorite?: number;
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
const ALL = '__all';
/** Group key for starred plans, which are gathered above the categories. */
const FAVORITES_KEY = '__favorites';

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

export default function Plans() {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState('');
  const today = useToday();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // The plan whose "start plan" sheet is open.
  const [startPlanId, setStartPlanId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  // Finished workouts per active plan, for the progress bar on its card.
  const [doneByPlan, setDoneByPlan] = useState<Record<string, number>>({});
  const [activationDate] = useState(localDateString());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(readCollapsedCategories);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
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
  const [builderStatus, setBuilderStatus] = useState('');
  const [builderLoading, setBuilderLoading] = useState(false);

  // YouTube playlist import. Hidden entirely when the server reports no
  // resolver (see server/src/external/index.ts), checked only once the builder
  // is open so the Plans page costs nothing extra to load.
  const importAvailable = useImportAvailable(isBuilderOpen);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // IDs from the most recent import, so the builder can filter down to them.

  // Optional AI plan drafting. Like the import above, the entry point is hidden
  // entirely unless the server reports a configured model (see server/src/ai/).
  // The AI modal only pre-fills this builder — it never saves a plan itself.
  const aiAvailable = useAiAvailable();
  const [isAiOpen, setIsAiOpen] = useState(false);

  // Plan details modal, opened by clicking a plan card (rather than one of the
  // buttons on it). Loads the plan's videos lazily, one plan at a time.
  const [detailsPlanId, setDetailsPlanId] = useState<string | null>(null);
  const [detailsDays, setDetailsDays] = useState<PlanDay[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Background image picker state (scoped per-plan)
  const [bgPickerPlanId, setBgPickerPlanId] = useState<string | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgPickerVideos, setBgPickerVideos] = useState<Video[]>([]);
  const [bgPickerLoading, setBgPickerLoading] = useState(false);

  // Today's freeze reason per active plan (planId -> reason), so the card can
  // show Freeze vs. Unfreeze without computing each plan's full schedule.
  const [freezeStatus, setFreezeStatus] = useState<Record<string, FreezeReason>>({});
  const [freezeModalPlanId, setFreezeModalPlanId] = useState<string | null>(null);
  // Export dialog target: a plan id, '*' for the whole-library backup, or null.
  const [exportTarget, setExportTarget] = useState<string | null>(null);
  // Distinct from isImportOpen above, which is the YouTube playlist dialog.
  const [isPlanImportOpen, setIsPlanImportOpen] = useState(false);
  const [freezeSaving, setFreezeSaving] = useState(false);
  const [unfreezingPlanId, setUnfreezingPlanId] = useState<string | null>(null);

  const fetchPlans = async () => {
    const res = await fetch('/api/plan');
    const data = await res.json();
    setPlans(data);
    fetchProgress();
  };

  const fetchProgress = async () => {
    try {
      const res = await fetch('/api/schedule');
      if (!res.ok) return;
      const data = await res.json();
      const done: Record<string, number> = {};
      for (const entry of data.schedules || []) {
        done[entry.planId] = (entry.schedule || []).filter(
          (d: { isWorkoutDay: boolean; workout?: { isCompleted?: boolean } | null }) => d.isWorkoutDay && d.workout?.isCompleted
        ).length;
      }
      setDoneByPlan(done);
    } catch {
      /* the bar just stays empty */
    }
  };

  const fetchFreezeStatus = async () => {
    const res = await fetch('/api/schedule/freeze-status');
    if (res.ok) setFreezeStatus(await res.json());
  };

  useEffect(() => {
    fetchPlans();
    fetchFreezeStatus();
    fetchProgress();
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

  const handleFreeze = async (planId: string, reason: FreezeReason, days: number) => {
    setFreezeSaving(true);
    try {
      const res = await fetch('/api/schedule/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, reason, days }),
      });
      if (res.ok) {
        setFreezeModalPlanId(null);
        fetchFreezeStatus();
      }
    } finally {
      setFreezeSaving(false);
    }
  };

  // Freezing here can cover several days at once, so undoing it clears the
  // whole run (today onward) rather than leaving the rest of it stranded.
  const handleUnfreeze = async (planId: string) => {
    setUnfreezingPlanId(planId);
    try {
      const res = await fetch(`/api/schedule/freeze/${encodeURIComponent(planId)}`, { method: 'DELETE' });
      if (res.ok) fetchFreezeStatus();
    } finally {
      setUnfreezingPlanId(null);
    }
  };

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

  const handleActivate = async (id: string, slot: Slot, startDate: string = activationDate) => {
    setStatus(t('plans.activating_status'));
    const res = await fetch(`/api/plan/activate/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, slot })
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

  const handleToggleFavorite = async (plan: Plan) => {
    const next = plan.is_favorite === 1 ? 0 : 1;
    // Optimistic: the heart should answer the tap, not the round trip.
    setPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, is_favorite: next } : p)));
    try {
      const res = await fetch(`/api/plan/${plan.id}/favorite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: next === 1 }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, is_favorite: plan.is_favorite ?? 0 } : p)));
    }
  };

  const handleDelete = async (id: string) => {
    const plan = plans.find(p => p.id === id);
    const ok = await confirmDialog({
      title: t('plans.delete_title', { name: plan?.name ?? '' }),
      message: t('plans.delete_confirm'),
      confirmLabel: t('plans.delete'),
      danger: true,
    });
    if (!ok) return;
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

        // Set the video IDs for this day, and remember which saved day it is so
        // saving updates it in place and its progress survives the edit.
        weeks[weekIndex].days[dayIndex].videoIds = videoIds;
        weeks[weekIndex].days[dayIndex].workoutId = workout.id;
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


  const handleSaveBuilderPlan = async () => {
    const selectedDays = builderWeeks.flatMap(week =>
      week.days.map(day => {
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
      setPlanDescription('');
      setBuilderPattern(globalPattern);
      setBuilderPatternCustom(false);
      setBuilderCategory('');
      setBuilderCustomCategory('');
      setBuilderWeeks(createInitialBuilderWeeks());
      setBuilderCurrentWeek(0);
      setBuilderCurrentDay(0);
      setStatus(t('plans.builder_saved', { count: selectedDays.length }));
      fetchPlans();
    }
  };


  const closeBuilder = () => {
    setIsBuilderOpen(false);
    setEditingPlanId(null);
    setPlanDescription('');
    setBuilderPattern(globalPattern);
    setBuilderPatternCustom(false);
    setBuilderCategory('');
    setBuilderCustomCategory('');
    setBuilderWeeks(createInitialBuilderWeeks());
    setBuilderCurrentWeek(0);
    setBuilderCurrentDay(0);
    setBuilderStatus('');
    setIsImportOpen(false);
  };



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

  // Remaining plans are grouped under category headings: known presets first (in
  // their canonical order), then custom labels A→Z, then uncategorized plans last.
  const planGroups = (() => {
    // Starred plans live in their own group above the categories, and only
    // there — listing them twice would make every count on the page lie.
    const favorites = otherPlans.filter(p => p.is_favorite === 1);
    const byCategory = new Map<string, Plan[]>();
    for (const plan of otherPlans) {
      if (plan.is_favorite === 1) continue;
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
    return [
      ...(favorites.length > 0 ? [{ key: FAVORITES_KEY, plans: favorites }] : []),
      ...ordered.map(key => ({ key, plans: byCategory.get(key) || [] })),
    ];
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


  // The plan's own rhythm, shown wherever its name and start date are — the
  // three together are what turn an ordered list of workouts into dated days.

  // Category chooser used in both the create flow (step 1) and the edit form.

  // The confirmation line is a passing note, not a fixture of the page.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const openUploadPicker = () => uploadInputRef.current?.click();

  const formatShort = (date: string) =>
    new Date(`${date}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });

  const cardData = (plan: Plan): PlanCardData => ({
    id: plan.id,
    name: plan.name,
    cover: resolveBackgroundUrl(plan.background_image),
    blur: Boolean(plan.background_blur),
    workoutCount: plan.workout_count ?? 0,
    equipment: (plan.equipment || []).map(id => labels.equipment(id)),
    hasExternal: Boolean(plan.has_external),
    favorite: plan.is_favorite === 1,
  });

  const startPlan = plans.find(p => p.id === startPlanId) || null;

  const groupLabel = (key: string) =>
    key === FAVORITES_KEY ? t('plans.favorites') : key ? categoryLabel(key) : t('plans.category_none');

  const categoryTabs = planGroups.map(g => ({
    key: g.key || UNCATEGORIZED_KEY,
    label: groupLabel(g.key),
    n: g.plans.length,
  }));

  const needle = query.trim().toLowerCase();
  const visibleGroups = planGroups
    .filter(g => categoryFilter === ALL || (g.key || UNCATEGORIZED_KEY) === categoryFilter)
    .map(g => ({ ...g, plans: g.plans.filter(p => !needle || p.name.toLowerCase().includes(needle)) }))
    .filter(g => g.plans.length > 0);

  return (
    <div className="rx-wrap pl-page">
      <header className="pl-head">
        <div className="pl-head-row">
          <div className="pl-head-text">
            <h1 className="rx-h1">{t('plans.title')}</h1>
            <p className="pl-lede">{t('plans.upload_msg')}</p>
          </div>
          <button type="button" className="pl-plus" aria-label={t('plans.create')} onClick={() => setIsCreateOpen(true)}>
            <Plus size={20} />
          </button>
        </div>

        <div className="pl-actions">
          <button type="button" className="rx-btn rx-btn--primary" onClick={() => setIsBuilderOpen(true)}>
            <ListPlus size={17} />
            {t('plans.build_btn')}
          </button>
          {aiAvailable && (
            <button type="button" className="rx-btn" onClick={() => setIsAiOpen(true)}>
              <Sparkles size={17} />
              {t('ai.build_btn')}
            </button>
          )}
          <span className="pl-actions-spacer" />
          {/* Bringing a plan in from a file is one quiet button that asks which
              format, so the two ways of *making* a plan are the only loud ones. */}
          <ImportMenu onCsv={openUploadPicker} onJson={() => setIsPlanImportOpen(true)} />
          <span className="pl-actions-divider" aria-hidden="true" />
          <button type="button" className="pl-quiet" onClick={() => setExportTarget('*')}>
            <HardDriveUpload size={16} />
            {t('transfer.backup_all_btn')}
          </button>
        </div>
        <input
          ref={uploadInputRef}
          type="file"
          accept=".csv, .tsv"
          hidden
          onChange={e => {
            const selected = e.target.files?.[0];
            if (selected) handleFileUpload(selected);
            e.target.value = '';
          }}
        />
      </header>

      {status && (
        <div className="pl-status" role="status">
          <Check size={16} />
          {status}
        </div>
      )}

      <h2 className="pl-section-label">{t('plans.active_caps')}</h2>
      <div className="pl-active-grid">
        {(['main', 'extra'] as Slot[]).map(slot => {
          const plan = activePlans.find(p => slotOf(p) === slot);
          if (!plan) return <EmptySlot key={slot} slot={slot} />;
          const frozen = Boolean(freezeStatus[plan.id]);
          return (
            <ActivePlanCard
              key={plan.id}
              plan={cardData(plan)}
              slot={slot}
              category={plan.category ? categoryLabel(plan.category) : null}
              frozen={frozen}
              status={
                frozen
                  ? t('plans.status_paused')
                  : t(plan.start_date > today ? 'plans.status_starts' : 'plans.status_started', { date: formatShort(plan.start_date) })
              }
              done={doneByPlan[plan.id] || 0}
              freezeBusy={unfreezingPlanId === plan.id}
              onOpen={() => openPlanDetails(plan.id)}
              onEdit={() => handleEditPlan(plan.id)}
              onFreeze={() => (frozen ? handleUnfreeze(plan.id) : setFreezeModalPlanId(plan.id))}
              onDeactivate={() => handleDeactivate(plan.id)}
              onChangeCover={() => openBackgroundPicker(plan.id)}
              onBackup={() => setExportTarget(plan.id)}
              onFavorite={() => handleToggleFavorite(plan)}
            />
          );
        })}
      </div>

      {otherPlans.length > 0 && (
        <div className="pl-find">
          <label className="pl-search">
            <Search size={18} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('plans.search_placeholder')}
              aria-label={t('plans.search_placeholder')}
            />
          </label>
          {showCategoryHeadings && (
            <div className="pl-cats">
              {[{ key: ALL, label: t('plans.filter_all'), n: otherPlans.length }, ...categoryTabs].map(c => (
                <button
                  key={c.key}
                  type="button"
                  className={`pl-cat${categoryFilter === c.key ? ' is-on' : ''}`}
                  onClick={() => setCategoryFilter(c.key)}
                >
                  {c.label}<span>{c.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {visibleGroups.map(group => {
        const storageKey = categoryStorageKey(group.key);
        const collapsed = showCategoryHeadings && collapsedCategories.has(storageKey);
        const headingLabel = groupLabel(group.key);
        return (
          <section key={storageKey} className="pl-group">
            {showCategoryHeadings && (
              <button
                type="button"
                className="pl-group-head"
                aria-expanded={!collapsed}
                onClick={() => toggleCategoryCollapsed(group.key)}
              >
                {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                <h2>{headingLabel}</h2>
                <span className="pl-group-count">{group.plans.length}</span>
              </button>
            )}
            {!collapsed && (
              <div className="pl-grid">
                {group.plans.map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={cardData(plan)}
                    onOpen={() => openPlanDetails(plan.id)}
                    onStart={() => setStartPlanId(plan.id)}
                    onEdit={() => handleEditPlan(plan.id)}
                    onChangeCover={() => openBackgroundPicker(plan.id)}
                    onBackup={() => setExportTarget(plan.id)}
                    onFavorite={() => handleToggleFavorite(plan)}
                    onDelete={() => handleDelete(plan.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {otherPlans.length > 0 && visibleGroups.length === 0 && (
        <div className="pl-none">{t('plans.no_match')}</div>
      )}

      {plans.length === 0 && (
        <div className="pl-none">
          {t('plans.no_plans')}
        </div>
      )}

      {isCreateOpen && (
        <CreateSheet
          aiAvailable={aiAvailable === true}
          onUpload={openUploadPicker}
          onBuild={() => setIsBuilderOpen(true)}
          onAi={() => setIsAiOpen(true)}
          onImport={() => setIsPlanImportOpen(true)}
          onBackup={() => setExportTarget('*')}
          onClose={() => setIsCreateOpen(false)}
        />
      )}

      {startPlan && (
        <StartPlanSheet
          plan={cardData(startPlan)}
          occupied={{
            main: activePlans.find(p => slotOf(p) === 'main')?.name ?? null,
            extra: activePlans.find(p => slotOf(p) === 'extra')?.name ?? null,
          }}
          defaultSlot={activePlans.some(p => slotOf(p) === 'main') && !activePlans.some(p => slotOf(p) === 'extra') ? 'extra' : 'main'}
          defaultDate={today}
          onClose={() => setStartPlanId(null)}
          onConfirm={(slot, date) => {
            const id = startPlan.id;
            setStartPlanId(null);
            handleActivate(id, slot, date);
          }}
        />
      )}

      {detailsPlan && (
        <PlanPreviewModal
          name={detailsPlan.name}
          slot={slotOf(detailsPlan)}
          categoryLabel={detailsPlan.category ? categoryLabel(detailsPlan.category) : null}
          cover={resolveBackgroundUrl(detailsPlan.background_image)}
          description={detailsPlan.description}
          equipment={(detailsPlan.equipment || []).map(eq => labels.equipment(eq))}
          startDate={detailsPlan.start_date}
          done={doneByPlan[detailsPlan.id] ?? 0}
          days={detailsDays}
          loading={detailsLoading}
          perWeek={workoutSlots(parsePlanPattern(detailsPlan.workout_pattern) ?? globalPattern)}
          needsInternet={Boolean(detailsPlan.has_external)}
          defaultDate={activationDate}
          onClose={closePlanDetails}
          onEdit={() => { closePlanDetails(); handleEditPlan(detailsPlan.id); }}
          onDuplicate={() => { handleDuplicate(detailsPlan.id); closePlanDetails(); }}
          onExport={() => { const id = detailsPlan.id; closePlanDetails(); setExportTarget(id); }}
          onDelete={async () => { await handleDelete(detailsPlan.id); closePlanDetails(); }}
          onDeactivate={() => { handleDeactivate(detailsPlan.id); closePlanDetails(); }}
          onStart={(slot, date) => { handleActivate(detailsPlan.id, slot, date); closePlanDetails(); }}
        />
      )}

      {bgPickerPlanId && (
        <CoverPickerModal
          planName={bgPickerPlan?.name ?? ''}
          currentUrl={bgPickerCurrentUrl}
          blurred={Boolean(bgPickerPlan?.background_blur)}
          loading={bgPickerLoading}
          videos={bgPickerVideos}
          uploading={bgUploading}
          onClose={closeBackgroundPicker}
          onPick={path => handleSelectThumbnailBackground(bgPickerPlanId, path)}
          onUpload={file => handleUploadBackground(bgPickerPlanId, file)}
          onBlur={blur => handleToggleBackgroundBlur(bgPickerPlanId, blur)}
          onRemove={() => handleClearBackground(bgPickerPlanId)}
        />
      )}

      {isImportOpen && (
        <YouTubeImportModal onClose={() => setIsImportOpen(false)} onImported={handleImported} />
      )}

      {exportTarget && (
        <ExportPlanModal
          planId={exportTarget === '*' ? null : exportTarget}
          planName={plans.find(p => p.id === exportTarget)?.name}
          onClose={() => setExportTarget(null)}
        />
      )}

      {isPlanImportOpen && (
        <ImportPlanModal
          onClose={() => setIsPlanImportOpen(false)}
          onImported={names => {
            setIsPlanImportOpen(false);
            setStatus(t('transfer.imported', { names: names.join(', ') }));
            fetchPlans();
          }}
        />
      )}

      {freezeModalPlanId && (
        <FreezePlanModal
          planName={plans.find(p => p.id === freezeModalPlanId)?.name ?? ''}
          saving={freezeSaving}
          onConfirm={(reason, days) => handleFreeze(freezeModalPlanId, reason, days)}
          onClose={() => setFreezeModalPlanId(null)}
        />
      )}

      {isBuilderOpen && (
        <PlanBuilderScreen
          editing={Boolean(editingPlanId)}
          onClose={closeBuilder}
          name={planName}
          onName={setPlanName}
          description={planDescription}
          onDescription={setPlanDescription}
          categories={[
            ...PLAN_CATEGORIES.map(value => ({ value, label: categoryLabel(value) })),
            { value: 'custom', label: t('plans.category_custom') },
          ]}
          category={builderCategory}
          onCategory={setBuilderCategory}
          customCategory={builderCustomCategory}
          onCustomCategory={setBuilderCustomCategory}
          patternCustom={builderPatternCustom}
          onPatternCustom={next => {
            setBuilderPatternCustom(next);
            if (!next) setBuilderPattern(globalPattern);
          }}
          pattern={builderPattern}
          onPattern={setBuilderPattern}
          weeks={builderWeeks}
          onWeeks={setBuilderWeeks}
          currentWeek={builderCurrentWeek}
          onCurrentWeek={setBuilderCurrentWeek}
          currentDay={builderCurrentDay}
          onCurrentDay={setBuilderCurrentDay}
          videos={allVideos}
          onToggleVideo={toggleVideoForDay}
          onAddFromYouTube={importAvailable ? () => setIsImportOpen(true) : undefined}
          saving={builderLoading}
          status={builderStatus}
          onSave={handleSaveBuilderPlan}
        />
      )}

      {/* Renders its own portal; only mounted once the server reports a
          configured model, so this whole branch is inert by default. */}
      <AiPlanModal
        open={isAiOpen}
        onClose={() => setIsAiOpen(false)}
        onGenerated={handleAiGenerated}
        onSaved={count => { setIsAiOpen(false); setStatus(t('plans.builder_saved', { count })); fetchPlans(); }}
      />
    </div>
  );
}
