import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, ChevronLeft, ChevronRight, Copy, LayoutGrid, List, Pencil, Play, Trash2, Upload, X } from 'lucide-react';
import Modal from '../modal/Modal';
import { TagRow } from '../library/LibraryCards';
import { formatDuration, stripVideoExt, useVideoTags } from '../../lib/videoTags';
import type { Video } from '../../types/video';
import type { Slot } from './StartPlanSheet';
import '../../styles/planpreview.css';

export interface PreviewDay {
  id: string;
  name: string;
  sequence_order: number;
  videos: Video[];
}

interface Props {
  name: string;
  /** The slot the plan is running in, or null when it isn't active. */
  slot: Slot | null;
  categoryLabel: string | null;
  /** Resolved cover URL, if the plan has one. */
  cover: string | null;
  description?: string | null;
  equipment: string[];
  startDate: string;
  /** Finished workouts, for the progress bar and the check on the first days. */
  done: number;
  days: PreviewDay[];
  loading: boolean;
  /** Workout days per week, so the days can be laid out week by week. */
  perWeek: number;
  /** Set when the plan has videos that stream rather than play offline. */
  needsInternet: boolean;
  defaultDate: string;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onDeactivate: () => void;
  onStart: (slot: Slot, date: string) => void;
}

/** The plan's videos for a day, with a small stepper when it holds more than one. */
function DayMedia({ day, index, done, list }: { day: PreviewDay; index: number; done: boolean; list?: boolean }) {
  const { t } = useTranslation();
  const tagsFor = useVideoTags();
  const [i, setI] = useState(0);
  const videos = day.videos;
  const cur = videos[Math.min(i, Math.max(videos.length - 1, 0))];
  const dur = formatDuration(cur?.duration_seconds);
  const step = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setI(p => (p + delta + videos.length) % videos.length);
  };
  const tags = cur ? tagsFor(cur) : [];
  const title = cur ? stripVideoExt(cur.filename) : '';

  const thumb = (
    <div className="pp-thumb">
      {cur?.thumbnail_path ? <img src={`/thumbnails/${cur.thumbnail_path}`} alt="" loading="lazy" /> : null}
      {!list && (
        <span className={`pp-daybadge${done ? ' is-done' : ''}`}>
          {done && <Check size={12} />}{t('plans.details_day_n', { n: index + 1 })}
        </span>
      )}
      {dur && <span className="pp-dur">{dur}</span>}
      {videos.length > 1 && (
        <span className="pp-step" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={step(-1)} aria-label={t('plans.scroll_prev')}><ChevronLeft size={14} /></button>
          <span>{Math.min(i, videos.length - 1) + 1}/{videos.length}</span>
          <button type="button" onClick={step(1)} aria-label={t('plans.scroll_next')}><ChevronRight size={14} /></button>
        </span>
      )}
    </div>
  );

  if (list) {
    return (
      <div className="pp-row">
        {thumb}
        <div className="pp-row-text">
          <div className={`pp-row-day${done ? ' is-done' : ''}`}>{done && <Check size={12} />}{t('plans.details_day_n', { n: index + 1 })}</div>
          <div className="pp-title">{title}</div>
          <TagRow tags={tags} rows={2} />
        </div>
      </div>
    );
  }
  return (
    <div className="pp-card">
      {thumb}
      <div className="pp-card-text">
        <div className="pp-title">{title}</div>
        <TagRow tags={tags} rows={2} />
      </div>
    </div>
  );
}

/** A plan opened for a look: what's in it, week by week, and everything you can do with it. */
export default function PlanPreviewModal(props: Props) {
  const { name, slot, categoryLabel, cover, description, equipment, startDate, done, days, loading, perWeek, needsInternet, defaultDate, onClose } = props;
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<'grid' | 'list'>(() => (window.matchMedia('(max-width: 767px)').matches ? 'list' : 'grid'));
  const [pickSlot, setPickSlot] = useState<Slot>('main');
  const [date, setDate] = useState(defaultDate);

  const weeks = useMemo(() => {
    const size = Math.max(1, perWeek);
    const out: { start: number; days: PreviewDay[] }[] = [];
    for (let i = 0; i < days.length; i += size) out.push({ start: i, days: days.slice(i, i + size) });
    return out;
  }, [days, perWeek]);

  const hours = (ds: PreviewDay[]) => {
    const secs = ds.reduce((sum, d) => sum + d.videos.reduce((s, v) => s + (v.duration_seconds || 0), 0), 0);
    return Math.round((secs / 3600) * 10) / 10;
  };
  const started = new Date(`${startDate}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const total = days.length;

  return (
    <Modal width={1040} onClose={onClose} label={name}>
      <div className="pp-scroll">
        <div className="pp-hero">
          {cover && <img className="pp-hero-img" src={cover} alt="" />}
          <div className="pp-hero-scrim" />
          <div className="pp-hero-body">
            <div className="pp-hero-top">
              <div className="pp-badges">
                <span className="pp-badge pp-badge--kind">{t(slot === 'extra' ? 'plans.slot_extra' : slot === 'main' ? 'plans.slot_main' : 'plans.preview_kind_plan')}</span>
                {categoryLabel && <span className="pp-badge">{categoryLabel}</span>}
              </div>
              <button type="button" className="pp-x" onClick={onClose} aria-label={t('library.close')}><X size={18} /></button>
            </div>
            <h1>{name}</h1>
            <div className="pp-hero-meta">
              {[
                t('plans.workout_count', { count: total }),
                weeks.length > 0 ? t('plans.preview_weeks', { count: weeks.length }) : null,
                equipment.length ? equipment.join(', ') : null,
                needsInternet ? t('plans.needs_internet') : null,
              ].filter(Boolean).join(' · ')}
            </div>
            {description && <p className="pp-hero-desc">{description}</p>}
            {slot && total > 0 && (
              <div className="pp-hero-progress">
                <div><i style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div>
                <span>{t('plans.progress_done', { done, total })}</span>
              </div>
            )}
            <div className="pp-hero-actions">
              <button type="button" className="pp-act pp-act--edit" onClick={props.onEdit}><Pencil size={15} />{t('plans.edit')}</button>
              <button type="button" className="pp-act" onClick={props.onDuplicate} title={t('plans.duplicate')} aria-label={t('plans.duplicate')}><Copy size={16} /><span>{t('plans.duplicate')}</span></button>
              <button type="button" className="pp-act" onClick={props.onExport} title={t('transfer.export_btn')} aria-label={t('transfer.export_btn')}><Upload size={16} /><span>{t('transfer.export_btn')}</span></button>
              <span className="pp-grow" />
              <button type="button" className="pp-act pp-act--danger" onClick={props.onDelete} title={t('plans.delete')} aria-label={t('plans.delete')}><Trash2 size={16} /><span>{t('plans.delete')}</span></button>
            </div>
          </div>
        </div>

        <div className="pp-body">
          <div className="pp-body-head">
            <h2>{t('plans.details_days')}</h2>
            <div className="rx-seg rx-seg--icons rx-seg--sm">
              <button type="button" className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')} aria-label={t('plans.builder_grid_view')}><LayoutGrid size={15} /></button>
              <button type="button" className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} aria-label={t('plans.builder_list_view')}><List size={15} /></button>
            </div>
          </div>

          {loading ? (
            <p className="pp-muted">{t('plans.details_loading')}</p>
          ) : days.length === 0 ? (
            <p className="pp-muted">{t('plans.details_no_videos')}</p>
          ) : (
            weeks.map((week, w) => (
              <section key={w} className="pp-week">
                <div className="pp-week-head">
                  <span>{t('plans.preview_week_n', { n: w + 1 })}</span>
                  <em>{t('plans.preview_week_meta', { count: week.days.length, hours: hours(week.days) })}</em>
                </div>
                <div className={view === 'grid' ? 'pp-grid' : 'pp-list'}>
                  {week.days.map((day, i) => (
                    <DayMedia key={day.id} day={day} index={week.start + i} done={Boolean(slot) && week.start + i < done} list={view === 'list'} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <div className="pp-foot">
        {slot ? (
          <>
            <div className="pp-foot-info">
              <span className="pp-foot-icon"><Calendar size={16} /></span>
              <div>
                <div className="pp-foot-eyebrow">{t('plans.preview_active', { slot: t(slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main').toUpperCase() })}</div>
                <div className="pp-foot-line">{t('plans.status_started', { date: started })}</div>
              </div>
            </div>
            <button type="button" className="pp-foot-btn" onClick={props.onDeactivate}>{t('plans.deactivate')}</button>
          </>
        ) : (
          <>
            <input type="date" className="pp-date" value={date} onChange={e => setDate(e.target.value)} aria-label={t('plans.set_start_date')} />
            <div className="rx-seg">
              <button type="button" className={pickSlot === 'main' ? 'is-on' : ''} onClick={() => setPickSlot('main')}>{t('plans.preview_slot_main')}</button>
              <button type="button" className={pickSlot === 'extra' ? 'is-on' : ''} onClick={() => setPickSlot('extra')}>{t('plans.preview_slot_extra')}</button>
            </div>
            <button type="button" className="pp-foot-btn pp-foot-btn--primary" disabled={!date} onClick={() => props.onStart(pickSlot, date)}>
              <Play size={15} />{t('plans.start_plan')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
