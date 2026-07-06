import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import EquipmentPicker from '../components/EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, BODY_PARTS, INTENSITIES, TRAINING_TYPES, prettyLabel } from '../lib/metadata';
import { Video } from '../types/video';

interface Plan {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: number;
  start_date: string;
}

interface BuilderDay {
  name: string;
  videoIds: string[];
}

interface BuilderWeek {
  name: string;
  days: BuilderDay[];
}

const createWeek = (weekNumber: number): BuilderWeek => ({
  name: `Week ${weekNumber}`,
  days: Array.from({ length: 7 }, (_, i) => ({
    name: `Day ${i + 1}`,
    videoIds: [] as string[]
  }))
});

const createInitialBuilderWeeks = () => [createWeek(1)];

export default function Plans() {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [activationDate, setActivationDate] = useState(new Date().toISOString().split('T')[0]);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [builderStep, setBuilderStep] = useState(1);
  const [planName, setPlanName] = useState('My Custom Plan');
  const [builderStartDate, setBuilderStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [builderWeeks, setBuilderWeeks] = useState<BuilderWeek[]>(createInitialBuilderWeeks());
  const [builderCurrentWeek, setBuilderCurrentWeek] = useState(0);
  const [builderCurrentDay, setBuilderCurrentDay] = useState(0);
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [videoSearch, setVideoSearch] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string>('');
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string>('');
  const [showBuilderFilters, setShowBuilderFilters] = useState(false);
  const [videoViewMode, setVideoViewMode] = useState<'grid' | 'list'>('grid');
  const [builderStatus, setBuilderStatus] = useState('');
  const [builderLoading, setBuilderLoading] = useState(false);

  const fetchPlans = async () => {
    const res = await fetch('http://localhost:3000/api/plan');
    const data = await res.json();
    setPlans(data);
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleFileUpload = async () => {
    if (!file) return;
    setStatus(t('plans.uploading_status'));
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch('http://localhost:3000/api/plan/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) {
      setStatus(`Error: ${data.error}`);
    } else {
      setStatus(t('plans.uploaded_status', { count: data.workoutCount }));
      fetchPlans();
      setFile(null);
    }
  };

  const handleActivate = async (id: string) => {
    setStatus(t('plans.activating_status'));
    const res = await fetch(`http://localhost:3000/api/plan/activate/${id}`, {
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
    const res = await fetch(`http://localhost:3000/api/plan/${id}`, {
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
      const res = await fetch(`http://localhost:3000/api/plan/${planId}`);
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

  useEffect(() => {
    if (!isBuilderOpen || allVideos.length > 0) return;
    fetch('http://localhost:3000/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setAllVideos(data || []))
      .catch(() => setAllVideos([]));
  }, [isBuilderOpen, allVideos.length]);

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
      ? `http://localhost:3000/api/plan/${editingPlanId}`
      : 'http://localhost:3000/api/plan/create';

    const res = await fetch(endpoint, {
      method: editingPlanId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: planName,
        startDate: builderStartDate,
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

  const closeBuilder = () => {
    setIsBuilderOpen(false);
    setEditingPlanId(null);
    setBuilderStep(1);
    setBuilderWeeks(createInitialBuilderWeeks());
    setBuilderCurrentWeek(0);
    setBuilderCurrentDay(0);
    setBuilderStatus('');
    setVideoSearch('');
  };

  const builderVideos = allVideos.filter(video => {
    const query = videoSearch.trim().toLowerCase();
    const matchesText = !query || [video.filename, video.relative_path, video.description || '']
      .some(field => field?.toLowerCase().includes(query));

    const matchesEquipment = selectedEquipment.length === 0 || (video.equipment || []).some(id => selectedEquipment.includes(id));
    const matchesTrainingType = !selectedTrainingType || video.training_type === selectedTrainingType;
    const matchesIntensity = !selectedIntensity || video.intensity === selectedIntensity;
    const matchesBodyParts = selectedBodyParts.length === 0 || (video.body_parts || []).some(part => selectedBodyParts.includes(part));

    return matchesText && matchesEquipment && matchesTrainingType && matchesIntensity && matchesBodyParts;
  });

  const currentWeek = builderWeeks[builderCurrentWeek];
  const currentDay = currentWeek?.days[builderCurrentDay] || currentWeek?.days[0];

  return (
    <div className="plans-container">
      <div className="glass-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h1>{t('plans.manage_plans')}</h1>
        <p>{t('plans.upload_msg')}</p>
        
        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input 
            type="file" 
            accept=".csv, .tsv"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ color: 'white' }}
          />
          <button className="btn" onClick={handleFileUpload} disabled={!file}>{t('plans.upload_btn')}</button>
          <button className="btn" style={{ background: '#2d72ff', color: 'white' }} onClick={() => setIsBuilderOpen(true)}>{t('plans.build_btn')}</button>
        </div>
      </div>

      {status && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '2rem', background: 'rgba(0, 255, 157, 0.1)', color: 'var(--accent-color)', textAlign: 'center' }}>
          {status}
        </div>
      )}

      <div className="plans-grid" style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {plans.map(plan => (
          <div key={plan.id} className={`glass-card plan-card ${plan.is_active ? 'active' : ''}`} style={{ 
            padding: '1.5rem', 
            position: 'relative',
            border: plan.is_active ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)'
          }}>
            {plan.is_active === 1 && (
              <span style={{ 
                position: 'absolute', 
                top: '-10px', 
                right: '20px', 
                background: 'var(--accent-color)', 
                color: 'black', 
                padding: '2px 10px', 
                borderRadius: '10px',
                fontSize: '0.8rem',
                fontWeight: 'bold'
              }}>{t('plans.active')}</span>
            )}
            <h3 style={{ margin: '0 0 0.5rem 0' }}>{plan.name}</h3>
            <p style={{ fontSize: '0.9rem', color: '#ccc', marginBottom: '1rem' }}>
              {t('plans.uploaded_on', { date: new Date(plan.uploaded_at).toLocaleDateString(i18n.language) })}
            </p>
            
            {plan.is_active === 1 ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{t('plans.start_date')}: {plan.start_date}</p>
              </div>
            ) : (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{t('plans.set_start_date')}</label>
                <input 
                  type="date" 
                  value={activationDate}
                  onChange={e => setActivationDate(e.target.value)}
                  style={{ 
                    width: '100%', 
                    padding: '8px', 
                    borderRadius: '4px', 
                    background: 'var(--bg-color)', 
                    color: 'white', 
                    border: '1px solid var(--glass-border)' 
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => handleEditPlan(plan.id)}>{t('plans.edit')}</button>
              {!plan.is_active && (
                <button className="btn" style={{ flex: 1 }} onClick={() => handleActivate(plan.id)}>{t('plans.activate')}</button>
              )}
              <button className="btn btn-danger" style={{ background: 'rgba(255, 68, 68, 0.2)', color: '#ff4444' }} onClick={() => handleDelete(plan.id)}>{t('plans.delete')}</button>
            </div>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>
          {t('plans.no_plans')}
        </div>
      )}

      {isBuilderOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          zIndex: 1000,
          padding: '3rem 1.5rem 1.5rem',
          overflowY: 'auto'
        }}>
          <div style={{
            width: '100%',
            maxWidth: 960,
            maxHeight: '95vh',
            overflowY: 'auto',
            background: 'rgba(12, 14, 25, 0.96)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 24,
            padding: '2rem',
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
              <div>
                <h2 style={{ margin: 0 }}>{editingPlanId ? 'Edit Plan' : t('plans.builder_title')}</h2>
                <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>{t('plans.builder_intro')}</p>
                <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: '0.95rem' }}>{t('plans.builder_note')}</p>
              </div>
              <button className="btn" style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'white' }} onClick={closeBuilder}>✕</button>
            </div>

            {builderStep === 1 ? (
              <div style={{ display: 'grid', gap: 18 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>{t('plans.builder_plan_name')}</label>
                  <input value={planName} onChange={e => setPlanName(e.target.value)} placeholder={t('plans.builder_plan_name')} style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'white' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>{t('plans.builder_start_date')}</label>
                  <input type="date" value={builderStartDate} onChange={e => setBuilderStartDate(e.target.value)} style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'white' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button className="btn" style={{ background: 'rgba(255,255,255,0.08)' }} onClick={closeBuilder}>{t('plans.builder_cancel')}</button>
                  <button className="btn" onClick={() => setBuilderStep(2)}>{t('plans.builder_next')}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#aaa' }}>{t('plans.builder_step', { current: 2, total: 2 })}</p>
                    <h3 style={{ margin: '8px 0 0' }}>{`${currentWeek.name} - ${currentDay.name}`}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn" onClick={() => setBuilderStep(1)}>{t('plans.builder_back')}</button>
                    <button className="btn" onClick={() => setBuilderCurrentWeek(Math.max(builderCurrentWeek - 1, 0))} disabled={builderCurrentWeek === 0}>{t('plans.builder_prev_week')}</button>
                    <button className="btn" onClick={() => setBuilderCurrentWeek(Math.min(builderCurrentWeek + 1, builderWeeks.length - 1))} disabled={builderCurrentWeek === builderWeeks.length - 1}>{t('plans.builder_next_week')}</button>
                    <button className="btn" onClick={() => setBuilderWeeks(prev => [...prev, createWeek(prev.length + 1)])}>{t('plans.builder_add_week')}</button>
                    {builderWeeks.length > 1 && (
                      <button className="btn" style={{ background: 'rgba(255, 68, 68, 0.2)', color: '#ff4444' }} onClick={() => {
                        const newWeeks = renameWeeksAfterDeletion(
                          builderWeeks.filter((_, i) => i !== builderCurrentWeek)
                        );
                        setBuilderWeeks(newWeeks);
                        setBuilderCurrentWeek(Math.min(builderCurrentWeek, newWeeks.length - 1));
                      }}>{t('plans.builder_remove_week')}</button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                  <button className="btn" style={{ flex: 1, minWidth: 180 }} onClick={handleSaveBuilderPlan} disabled={builderLoading || !builderWeeks.some(week => week.days.some(day => day.videoIds.length > 0))}>{builderLoading ? t('plans.builder_saving') : t('plans.builder_save')}</button>
                </div>
                {builderStatus && (
                  <div style={{ color: '#ffb547', fontWeight: 600 }}>{builderStatus}</div>
                )}

                <div style={{ display: 'grid', gap: 12 }}>
                  {currentWeek.days.map((day, index) => {
                    const selected = builderCurrentDay === index;
                    return (
                      <div key={day.name} onClick={() => setBuilderCurrentDay(index)} style={{
                        cursor: 'pointer',
                        width: '100%',
                        padding: 14,
                        borderRadius: 16,
                        border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
                        background: selected ? 'rgba(59, 130, 246, 0.12)' : 'var(--surface-hover)',
                        color: 'white',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700 }}>{day.name}</span>
                          {day.videoIds.length > 0 && (
                            <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>{day.videoIds.length}</span>
                          )}
                        </div>
                        {day.videoIds.length === 0 ? (
                          <p style={{ margin: 0, color: '#aaa', fontSize: '0.85rem' }}>{t('plans.builder_no_selected_videos')}</p>
                        ) : (
                          <div style={{ display: 'grid', gap: 6 }}>
                            {day.videoIds.map(id => {
                              const video = allVideos.find(v => v.id === id);
                              return (
                                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 10px' }}>
                                  <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video ? video.filename : id}</span>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); removeVideoFromDay(builderCurrentWeek, index, id); }} style={{ border: 'none', background: 'transparent', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.95rem' }}>×</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <p style={{ marginBottom: 8, fontWeight: 700 }}>{t('plans.builder_selected_videos')}</p>
                    {currentDay.videoIds.length === 0 ? (
                      <p style={{ color: '#aaa' }}>{t('plans.builder_no_selected_videos')}</p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {currentDay.videoIds.map(id => {
                          const video = allVideos.find(v => v.id === id);
                          return (
                            <li key={id} style={{ marginBottom: 6 }}>{video ? video.filename : id}</li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gap: 10, alignItems: 'start' }}>
                    <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>{t('plans.builder_search')}</label>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input value={videoSearch} onChange={e => setVideoSearch(e.target.value)} placeholder={t('plans.builder_search')} style={{ flex: 1, minWidth: 220, padding: 12, borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'white' }} />
                      <button type="button" className="btn" style={{ minWidth: 120 }} onClick={() => setShowBuilderFilters(prev => !prev)}>{t('plans.builder_filters')}</button>
                      <button type="button" className="btn" style={{ minWidth: 120 }} onClick={() => setVideoViewMode(prev => prev === 'grid' ? 'list' : 'grid')}>{videoViewMode === 'grid' ? t('plans.builder_list_view') : t('plans.builder_grid_view')}</button>
                    </div>
                  </div>

                  {showBuilderFilters && (
                    <div style={{ display: 'grid', gap: 16, padding: 16, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <p style={{ margin: 0, fontWeight: 700 }}>{t('plans.builder_filter_equipment')}</p>
                          <button type="button" className="btn" style={{ padding: '6px 10px', minWidth: 'auto' }} onClick={() => {
                            setSelectedEquipment([]);
                            setSelectedTrainingType('');
                            setSelectedIntensity('');
                            setSelectedBodyParts([]);
                          }}>{t('plans.builder_clear_filters')}</button>
                        </div>
                        <EquipmentPicker selected={selectedEquipment} onChange={setSelectedEquipment} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                        <div>
                          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{t('plans.builder_training_type')}</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {TRAINING_TYPES.map(type => {
                              const selected = selectedTrainingType === type;
                              return (
                                <button type="button" key={type} onClick={() => setSelectedTrainingType(selected ? '' : type)} style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
                                  background: selected ? 'rgba(59, 130, 246, 0.15)' : 'var(--surface-hover)',
                                  color: 'white',
                                  cursor: 'pointer'
                                }}>
                                  <TrainingTypeIcon type={type} />
                                  <span style={{ fontSize: '0.85rem' }}>{type}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{t('plans.builder_intensity')}</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {INTENSITIES.map(level => {
                              const selected = selectedIntensity === level;
                              return (
                                <button type="button" key={level} onClick={() => setSelectedIntensity(selected ? '' : level)} style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
                                  background: selected ? 'rgba(59, 130, 246, 0.15)' : 'var(--surface-hover)',
                                  color: 'white',
                                  cursor: 'pointer'
                                }}>
                                  <IntensityIcon level={level} />
                                  <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>{prettyLabel(level)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{t('plans.builder_body_parts')}</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {BODY_PARTS.map(part => {
                              const selected = selectedBodyParts.includes(part);
                              return (
                                <button type="button" key={part} onClick={() => setSelectedBodyParts(prev => prev.includes(part) ? prev.filter(item => item !== part) : [...prev, part])} style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
                                  background: selected ? 'rgba(59, 130, 246, 0.15)' : 'var(--surface-hover)',
                                  color: 'white',
                                  cursor: 'pointer'
                                }}>
                                  <BodyPartIcon part={part} />
                                  <span style={{ fontSize: '0.85rem' }}>{prettyLabel(part)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: videoViewMode === 'grid' ? 'grid' : 'block', gap: videoViewMode === 'grid' ? 14 : 0, gridTemplateColumns: videoViewMode === 'grid' ? 'repeat(auto-fit, minmax(220px, 1fr))' : undefined }}>
                  {builderVideos.length === 0 ? (
                    <p style={{ color: '#aaa' }}>{t('plans.builder_no_videos')}</p>
                  ) : (
                    builderVideos.map(video => {
                      const selected = currentDay.videoIds.includes(video.id);
                      return (
                        <button key={video.id} type="button" className="btn" onClick={() => toggleVideoForDay(video.id)} style={{
                          display: 'flex',
                          flexDirection: videoViewMode === 'grid' ? 'column' : 'row',
                          justifyContent: 'space-between',
                          alignItems: videoViewMode === 'grid' ? 'stretch' : 'center',
                          gap: 10,
                          textAlign: 'left',
                          padding: 14,
                          background: selected ? 'rgba(40, 167, 69, 0.15)' : 'rgba(255,255,255,0.04)',
                          borderColor: selected ? 'rgba(40, 167, 69, 0.45)' : 'var(--glass-border)',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          minHeight: videoViewMode === 'grid' ? 160 : undefined
                        }}>
                          {videoViewMode === 'grid' ? (
                            <>
                              {video.thumbnail_path ? (
                                <img src={`http://localhost:3000/thumbnails/${video.thumbnail_path}`} alt={video.filename} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 14 }} />
                              ) : (
                                <div style={{ width: '100%', height: 120, borderRadius: 14, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>No thumbnail</div>
                              )}
                              <div style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontWeight: 700 }}>{video.filename}</span>
                                <span style={{ fontSize: '0.85rem', color: '#bbb' }}>{video.relative_path}</span>
                              </div>
                              <span style={{ opacity: 0.8, alignSelf: 'flex-end' }}>{selected ? '✓ Selected' : '+'}</span>
                            </>
                          ) : (
                            <>
                              <span>{video.filename}</span>
                              <span style={{ opacity: 0.65 }}>{selected ? '✓' : '+'}</span>
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
        </div>
      )}
    </div>
  );
}
