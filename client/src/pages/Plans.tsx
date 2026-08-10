import { useState, useEffect } from 'react';
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
import { Video } from '../types/video';

interface Plan {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: number;
  start_date: string;
  background_image?: string | null;
  background_blur?: number;
  workout_count?: number;
  equipment?: string[];
  category?: string | null;
  /** True when the plan contains videos that stream instead of playing offline. */
  has_external?: boolean;
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

export default function Plans() {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState('');
  const [activationDate, setActivationDate] = useState(new Date().toISOString().split('T')[0]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(readCollapsedCategories);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [builderStep, setBuilderStep] = useState(1);
  const [planName, setPlanName] = useState('My Custom Plan');
  const [builderStartDate, setBuilderStartDate] = useState(new Date().toISOString().split('T')[0]);
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

  const handleActivate = async (id: string) => {
    setStatus(t('plans.activating_status'));
    const res = await fetch(`/api/plan/activate/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: activationDate })
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.activated_status'));
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
    setBuilderStartDate(new Date().toISOString().split('T')[0]);
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

  // Opens the background picker for a specific plan, loading only the
  // videos that actually appear somewhere within that plan's workouts.
  const openBackgroundPicker = async (planId: string) => {
    setBgPickerPlanId(planId);
    setBgPickerTab('thumbnail');
    setBgPickerLoading(true);
    setBgPickerVideos([]);
    try {
      const res = await fetch(`/api/plan/${planId}`);
      const planData = await res.json();

      const idSet = new Set<string>();
      (planData.workouts || []).forEach((workout: any) => {
        try {
          const ids = JSON.parse(workout.video_ids || '[]');
          ids.forEach((id: string) => idSet.add(id));
        } catch (e) {
          // ignore malformed video_ids
        }
      });

      const vRes = await fetch('/api/library/videos');
      const videoList: Video[] = await vRes.json();

      setBgPickerVideos((videoList || []).filter(v => idSet.has(v.id) && v.thumbnail_path));
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

  // The active plan gets its own featured card above the grid of the remaining plans.
  const activePlan = plans.find(p => p.is_active === 1) || null;
  const otherPlans = plans.filter(p => p.is_active !== 1);

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

      {activePlan && (
        <div className="plan-featured">
          {/* Full-bleed image with a dark scrim, so every label on top is white —
              readable in all themes regardless of the theme's accent lightness. */}
          {(() => {
            const bgUrl = resolveBackgroundUrl(activePlan.background_image);
            return bgUrl ? (
              <div className={`plan-card-bg${activePlan.background_blur ? ' blurred' : ''}`} style={{ backgroundImage: `url(${bgUrl})` }} />
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
            onClick={() => openBackgroundPicker(activePlan.id)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>

          <div className="plan-featured-content">
            <div className="plan-featured-main">
              <div className="plan-featured-eyebrow">
                <span className="plan-featured-active">{t('plans.active')}</span>
                {activePlan.category && (
                  <span className="plan-featured-category">{categoryLabel(activePlan.category)}</span>
                )}
                {renderOfflineWarning(activePlan)}
              </div>
              <h2 className="plan-featured-title">{activePlan.name}</h2>
              <p className="plan-featured-date">
                <span>{t('plans.start_date')}</span>
                <strong>{activePlan.start_date}</strong>
              </p>
            </div>

            <div className="plan-featured-panel">
              <span className="plan-featured-count">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11v11h-11z"/><path d="M6.5 2v4.5M17.5 2v4.5M6.5 17.5V22M17.5 17.5V22M2 6.5h4.5M2 17.5h4.5M17.5 6.5H22M17.5 17.5H22"/></svg>
                {t('plans.workout_count', { count: activePlan.workout_count ?? 0 })}
              </span>

              {(activePlan.equipment || []).length > 0 && (
                <div className="plan-featured-equipment">
                  <span className="plan-featured-panel-label">{t('plans.builder_filter_equipment')}</span>
                  <div className="plan-featured-tags">
                    {(activePlan.equipment || []).map(eq => (
                      <span key={eq} className="plan-featured-tag" title={labels.equipment(eq)}>
                        <EquipmentIcon id={eq} size={13} />
                        {labels.equipment(eq)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="plan-card-actions">
                <button className="btn btn-ghost" onClick={() => handleEditPlan(activePlan.id)}>{t('plans.edit')}</button>
                <button className="btn btn-danger-ghost" onClick={() => handleDelete(activePlan.id)}>{t('plans.delete')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <div key={plan.id} className="glass-card plan-card">
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
                onClick={() => openBackgroundPicker(plan.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </button>

              <div className="plan-card-body">
                <h3 className="plan-card-title">{plan.name}</h3>

                {renderPlanInfo(plan)}

                <div className="plan-card-datefield">
                  <label>{t('plans.set_start_date')}</label>
                  <input
                    type="date"
                    value={activationDate}
                    onChange={e => setActivationDate(e.target.value)}
                  />
                </div>

                <div className="plan-card-actions">
                  <button className="btn btn-ghost" onClick={() => handleEditPlan(plan.id)}>{t('plans.edit')}</button>
                  <button className="btn btn-ghost" onClick={() => handleActivate(plan.id)}>{t('plans.activate')}</button>
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
                {renderCategoryField()}
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
                    {renderCategoryField()}
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
