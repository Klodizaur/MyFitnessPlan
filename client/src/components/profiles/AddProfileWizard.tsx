import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Copy, FolderOpen, Check, RotateCcw, UserPlus } from 'lucide-react';
import Modal, { CloseButton } from '../modal/Modal';
import {
  createProfile, inspectBackup, ProfileInfo, ProfilePlan, profilePlans, readBackupFile, reloadAsProfile, restoreAsProfile, selectProfile,
} from '../../lib/profiles';
import { AvatarChooser, EMPTY_PIN, PinChooser, pinResult } from './ProfileFields';
import ProfileAvatar from './ProfileAvatar';
import { confirmDialog } from '../../lib/confirm';

type Step = 'who' | 'start' | 'plans' | 'done';

/**
 * Adding someone, from "Who's training?": who they are, how they start, which
 * plans they take along.
 *
 * "Copy" starts from your own setup — the same video folder, favourites and
 * settings. "From scratch" starts empty, with their own folder picked
 * afterwards. Either way, plans come across as fresh copies: ticks and log
 * belong to the person who did the workouts.
 *
 * On a device nobody has picked a profile on yet (`current` null), there's no
 * one to copy from, so it's just who they are, from scratch.
 */
export default function AddProfileWizard({ takenAvatars, current, onClose }: {
  takenAvatars: string[];
  current: ProfileInfo | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('who');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => {
    const used = new Set(takenAvatars);
    return ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'].find(a => !used.has(a)) || 'avatar-1';
  });
  const [pin, setPin] = useState(EMPTY_PIN);
  const [mode, setMode] = useState<'copy' | 'fresh'>('fresh');
  const [plans, setPlans] = useState<ProfilePlan[] | null>(current ? null : []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<ProfileInfo | null>(null);
  // Which message, not its text: shown in whatever language is current.
  const [error, setError] = useState<{ key: string; params?: Record<string, unknown> } | null>(null);
  const errorText = error ? String(t(error.key, error.params)) : null;
  const [busy, setBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  /**
   * A new computer, or a fresh start: bring someone back from their backup,
   * under their old name and ID (so their next backups line up), then switch
   * to them.
   */
  const restoreFromBackup = async (file: File) => {
    setError(null);
    const data = await readBackupFile(file);
    if (!data) { setError({ key: 'backup.not_a_backup' }); return; }
    let summary;
    try {
      summary = await inspectBackup(data);
    } catch (err: any) {
      setError({ key: err?.code === 'newer_version' ? 'backup.newer_version' : 'backup.not_a_backup' });
      return;
    }
    if (summary.profileExistsHere) {
      setError({ key: 'backup.already_here', params: { name: summary.profileName } });
      return;
    }
    const ok = await confirmDialog({
      title: t('backup.restore_as_title', { name: summary.profileName }),
      message: t('backup.restore_as_message', {
        name: summary.profileName,
        date: new Date(summary.createdAt).toLocaleDateString(i18n.language, { dateStyle: 'medium' }),
        plans: summary.plans,
        entries: summary.logEntries,
      }),
      confirmLabel: t('backup.restore'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { profile } = await restoreAsProfile(data);
      await selectProfile(profile.id);
      reloadAsProfile();
    } catch {
      setBusy(false);
      setError({ key: 'backup.restore_failed' });
    }
  };

  // Your plans, ticked by default when copying your whole setup.
  useEffect(() => {
    if (!current) return;
    profilePlans(current.id)
      .then(data => setPlans(data.plans))
      .catch(() => setPlans([]));
  }, [current]);
  useEffect(() => {
    if (plans) setPicked(mode === 'copy' ? new Set(plans.map(p => p.id)) : new Set());
  }, [plans, mode]);

  const chosenPin = pinResult(pin);

  const nextFromWho = () => {
    if (!name.trim()) { setError({ key: 'profiles.name_required' }); return; }
    if (chosenPin.error) { setError({ key: `profiles.${chosenPin.error}` }); return; }
    setError(null);
    if (current) setStep('start');
    else create();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { profile } = await createProfile({
        name: name.trim(),
        avatar,
        pin: chosenPin.pin ?? undefined,
        mode: current ? mode : 'fresh',
        sourceId: current?.id,
        planIds: current ? [...picked] : [],
      });
      setCreated(profile);
      setStep('done');
    } catch {
      setError({ key: 'profiles.failed' });
    } finally {
      setBusy(false);
    }
  };

  /** Become the new profile on this device (with the PIN just chosen, if any). */
  const switchToNew = async () => {
    if (!created) return;
    setBusy(true);
    try {
      await selectProfile(created.id, chosenPin.pin ?? undefined);
      // From scratch, the next thing they need is their own video folder.
      reloadAsProfile(mode === 'fresh' || !current ? '/settings' : '/');
    } catch {
      setBusy(false);
      setError({ key: 'profiles.failed' });
    }
  };

  const togglePlan = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Modal width={560} onClose={onClose} busy={busy} label={t('profiles.add')}>
      <div className="md-head">
        <div className="md-icon"><UserPlus size={24} /></div>
        <div className="md-head-text">
          <h2 className="md-title">{step === 'done' && created ? t('profiles.ready', { name: created.name }) : t('profiles.add')}</h2>
          {step !== 'done' && current && (
            <div className="md-sub">{t('profiles.step_n', { n: step === 'who' ? 1 : step === 'start' ? 2 : 3, total: 3 })}</div>
          )}
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </div>

      <div className="md-body">
        {step === 'who' && (
          <>
            <label className="pf-field">
              <span className="pf-label">{t('profiles.name')}</span>
              <input className="pf-input" value={name} onChange={e => setName(e.target.value)} maxLength={40} autoFocus
                placeholder={t('profiles.name_placeholder_other')} />
            </label>
            <div className="pf-field">
              <span className="pf-label">{t('profiles.avatar')}</span>
              <AvatarChooser value={avatar} onChange={setAvatar} />
            </div>
            <PinChooser value={pin} onChange={setPin} />
            <button type="button" className="pf-link pf-restore-link" onClick={() => backupInput.current?.click()} disabled={busy}>
              <RotateCcw size={15} /> {t('backup.restore_profile_link')}
            </button>
            <input
              ref={backupInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) restoreFromBackup(file);
              }}
            />
          </>
        )}

        {step === 'start' && current && (
          <>
            <p className="md-text">{t('profiles.start_question', { name: name.trim() })}</p>
            <div className="pf-options">
              <button type="button" className={`pf-option${mode === 'copy' ? ' is-on' : ''}`} onClick={() => setMode('copy')}>
                <Copy size={20} />
                <span>
                  <strong>{t('profiles.mode_copy', { name: current.name })}</strong>
                  <span>{t('profiles.mode_copy_note')}</span>
                </span>
              </button>
              <button type="button" className={`pf-option${mode === 'fresh' ? ' is-on' : ''}`} onClick={() => setMode('fresh')}>
                <FolderOpen size={20} />
                <span>
                  <strong>{t('profiles.mode_fresh')}</strong>
                  <span>{t('profiles.mode_fresh_note')}</span>
                </span>
              </button>
            </div>
          </>
        )}

        {step === 'plans' && current && (
          <>
            <p className="md-text">{t('profiles.plans_question', { name: current.name })}</p>
            <div className="pf-plan-tools">
              <button type="button" className="pf-link" onClick={() => setPicked(new Set((plans || []).map(p => p.id)))}>{t('profiles.select_all')}</button>
              <button type="button" className="pf-link" onClick={() => setPicked(new Set())}>{t('profiles.select_none')}</button>
              <span className="pf-hint">{t('profiles.plans_picked', { count: picked.size })}</span>
            </div>
            <ul className="pf-plans">
              {(plans || []).map(plan => (
                <li key={plan.id}>
                  <label className="pf-check">
                    <input type="checkbox" checked={picked.has(plan.id)} onChange={() => togglePlan(plan.id)} />
                    <span>{plan.name}</span>
                    <span className="pf-hint">{t('profiles.plan_workouts', { count: plan.workout_count })}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="pf-hint">{t('profiles.plans_fresh_note')}</p>
          </>
        )}

        {step === 'done' && created && (
          <div className="pf-done">
            <ProfileAvatar avatar={created.avatar} ownerName={created.name} className="pf-avatar pf-avatar--lg" />
            <p className="md-text">
              {mode === 'fresh' || !current ? t('profiles.done_fresh', { name: created.name }) : t('profiles.done_copy', { name: created.name })}
            </p>
          </div>
        )}

        {error && <div className="md-error" role="alert">{errorText}</div>}
      </div>

      <div className="md-foot md-foot--line pf-foot">
        {step === 'who' && (
          <button type="button" className="md-btn md-btn--primary" onClick={nextFromWho} disabled={busy}>
            {current ? <>{t('profiles.next')} <ArrowRight size={16} /></> : <><Check size={16} /> {t('profiles.create')}</>}
          </button>
        )}
        {step === 'start' && (
          <>
            <button type="button" className="md-btn" onClick={() => setStep('who')}><ArrowLeft size={16} /> {t('profiles.back')}</button>
            {plans && plans.length === 0 ? (
              <button type="button" className="md-btn md-btn--primary" onClick={create} disabled={busy}>
                <Check size={16} /> {t('profiles.create')}
              </button>
            ) : (
              <button type="button" className="md-btn md-btn--primary" onClick={() => setStep('plans')} disabled={!plans}>
                {t('profiles.next')} <ArrowRight size={16} />
              </button>
            )}
          </>
        )}
        {step === 'plans' && (
          <>
            <button type="button" className="md-btn" onClick={() => setStep('start')} disabled={busy}><ArrowLeft size={16} /> {t('profiles.back')}</button>
            <button type="button" className="md-btn md-btn--primary" onClick={create} disabled={busy}>
              <Check size={16} /> {t('profiles.create')}
            </button>
          </>
        )}
        {step === 'done' && created && (
          <>
            <button type="button" className="md-btn" onClick={onClose} disabled={busy}>
              {current ? t('profiles.stay_as', { name: current.name }) : t('profiles.not_now')}
            </button>
            <button type="button" className="md-btn md-btn--primary" onClick={switchToNew} disabled={busy}>
              {mode === 'fresh' || !current ? t('profiles.switch_and_folder', { name: created.name }) : t('profiles.switch_to', { name: created.name })}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
