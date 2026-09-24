import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, HardDriveUpload, Image as ImageIcon, MoreHorizontal, Pencil, Play, Plus, Snowflake, Trash2, WifiOff } from 'lucide-react';

/** What a card needs to know about a plan, already resolved by the page. */
export interface PlanCardData {
  id: string;
  name: string;
  cover: string | null;
  blur: boolean;
  workoutCount: number;
  /** Equipment already turned into display labels. */
  equipment: string[];
  hasExternal: boolean;
  favorite: boolean;
}

function PlanCover({ plan, className, onFavorite }: { plan: PlanCardData; className: string; onFavorite?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={`${className} pl-cover${plan.cover ? '' : ' pl-cover--empty'}`}>
      {plan.cover ? (
        <img src={plan.cover} alt="" className={plan.blur ? 'is-blurred' : undefined} />
      ) : (
        <img src="/logo.png" alt="" className="pl-cover-logo" />
      )}
      {onFavorite && (
        <button
          type="button"
          className={`rx-heart${plan.favorite ? ' is-on' : ''}`}
          aria-pressed={plan.favorite}
          aria-label={t(plan.favorite ? 'plans.unfavorite' : 'plans.favorite')}
          title={t(plan.favorite ? 'plans.unfavorite' : 'plans.favorite')}
          onClick={e => { e.stopPropagation(); onFavorite(); }}
        >
          <Heart size={15} />
        </button>
      )}
    </div>
  );
}

/** Equipment as read-only tags. A plan with none says so, rather than a gap. */
function EquipmentTags({ labels }: { labels: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="rx-tags rx-tags--2">
      {labels.length > 0 ? (
        labels.map(label => (
          <span key={label} className="rx-tag rx-tag--gear" title={label}>{label}</span>
        ))
      ) : (
        <span className="rx-tag rx-tag--gear">{t('plans.no_equipment_tag')}</span>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  run: () => void;
}

/** The ⋯ button and its popover. Closes on an outside click or Escape. */
export function PlanMenu({ items, className }: { items: MenuItem[]; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`pl-menu${className ? ` ${className}` : ''}`} ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="pl-menu-btn"
        aria-label={t('plans.more_actions')}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="pl-menu-pop" role="menu">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'is-danger' : undefined}
              onClick={() => { setOpen(false); item.run(); }}
            >
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OfflineNote({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <span className="pl-offline" title={t('plans.needs_internet_hint')}>
      <WifiOff size={12} />
      {t('plans.needs_internet')}
    </span>
  );
}

export interface ActivePlanCardProps {
  plan: PlanCardData;
  slot: 'main' | 'extra';
  category: string | null;
  frozen: boolean;
  status: string;
  done: number;
  freezeBusy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onFreeze: () => void;
  onDeactivate: () => void;
  onChangeCover: () => void;
  onBackup: () => void;
  onFavorite: () => void;
}

export function ActivePlanCard(props: ActivePlanCardProps) {
  const { t } = useTranslation();
  const { plan, frozen } = props;
  const pct = plan.workoutCount > 0 ? Math.min(100, (props.done / plan.workoutCount) * 100) : 0;

  return (
    <div
      className="rx-card pl-active"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          props.onOpen();
        }
      }}
    >
      <div className="pl-active-media">
        <PlanCover plan={plan} className={`pl-active-cover${frozen ? ' is-frozen' : ''}`} onFavorite={props.onFavorite} />
        <div className="pl-pills">
          <span className={`pl-pill pl-pill--${props.slot}`}>
            {t(props.slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')}
          </span>
          {props.category && <span className="pl-pill pl-pill--dark">{props.category}</span>}
          {frozen && (
            <span className="pl-pill pl-pill--frozen">
              <Snowflake size={12} />
              {t('plans.frozen')}
            </span>
          )}
        </div>
        <PlanMenu
          className="pl-menu--cover"
          items={[
            { label: t('plans.change_cover'), icon: <ImageIcon size={16} />, run: props.onChangeCover },
            { label: t('plans.backup_plan'), icon: <HardDriveUpload size={16} />, run: props.onBackup },
          ]}
        />
      </div>

      <div className="pl-active-body">
        <div className="pl-active-name">{plan.name}</div>
        <div className="pl-active-meta">
          <strong>{props.status}</strong> · {t('plans.workout_count', { count: plan.workoutCount })}
          <OfflineNote show={plan.hasExternal} />
        </div>
        <EquipmentTags labels={plan.equipment} />

        <div className="pl-active-progress">
          <div className={`rx-progress${frozen ? ' rx-progress--paused' : ''}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span>{t('plans.progress_done', { done: props.done, total: plan.workoutCount })}</span>
        </div>

        <div className="pl-active-actions" onClick={e => e.stopPropagation()}>
          <button type="button" className="pl-soft-btn" onClick={props.onEdit}>
            <Pencil size={15} />
            {t('plans.edit')}
          </button>
          <button type="button" className="pl-soft-btn" disabled={props.freezeBusy} onClick={props.onFreeze}>
            {frozen ? <Play size={15} /> : <Snowflake size={15} />}
            {frozen ? t('plans.resume') : t('plans.freeze')}
          </button>
          <button type="button" className="pl-soft-btn pl-soft-btn--danger" onClick={props.onDeactivate}>
            {t('plans.deactivate')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptySlot({ slot }: { slot: 'main' | 'extra' }) {
  const { t } = useTranslation();
  return (
    <div className="pl-empty-slot">
      <div className="pl-empty-icon"><Plus size={22} /></div>
      <div>
        <div className="pl-empty-kind">
          {t(slot === 'extra' ? 'plans.slot_extra_caps' : 'plans.slot_main_caps')}
        </div>
        <div className="pl-empty-note">{t('plans.slot_empty')}</div>
      </div>
    </div>
  );
}

export interface PlanCardProps {
  plan: PlanCardData;
  onOpen: () => void;
  onStart: () => void;
  onEdit: () => void;
  onChangeCover: () => void;
  onBackup: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}

export function PlanCard({ plan, onOpen, onStart, onEdit, onChangeCover, onBackup, onFavorite, onDelete }: PlanCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="rx-card pl-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <PlanCover plan={plan} className="pl-card-cover" onFavorite={onFavorite} />

      <div className="pl-card-body">
        <div className="pl-card-top">
          <div className="pl-card-name">{plan.name}</div>
          <PlanMenu
            items={[
              { label: t('plans.edit_plan'), icon: <Pencil size={16} />, run: onEdit },
              { label: t('plans.change_cover'), icon: <ImageIcon size={16} />, run: onChangeCover },
              { label: t('plans.backup_plan'), icon: <HardDriveUpload size={16} />, run: onBackup },
              { label: t('plans.delete'), icon: <Trash2 size={16} />, danger: true, run: onDelete },
            ]}
          />
        </div>

        <div className="pl-card-count">
          {t('plans.workout_count', { count: plan.workoutCount })}
          <OfflineNote show={plan.hasExternal} />
        </div>
        <EquipmentTags labels={plan.equipment} />

        <div className="pl-card-spacer" />
        <button
          type="button"
          className="pl-start-btn"
          onClick={e => { e.stopPropagation(); onStart(); }}
        >
          <Play size={15} />
          {t('plans.start_plan')}
        </button>
      </div>
    </div>
  );
}
