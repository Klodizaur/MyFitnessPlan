import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import EquipmentPicker from './EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, TRAINING_TYPES, BODY_PARTS } from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';
import { useAiAvailable } from '../lib/useAiAvailable';
import { useTranslation } from 'react-i18next';
import { Video } from '../types/video';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
};

const listIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3.5" y1="6" x2="3.51" y2="6" /><line x1="3.5" y1="12" x2="3.51" y2="12" /><line x1="3.5" y1="18" x2="3.51" y2="18" />
  </svg>
);

const quoteIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="4" x2="5" y2="20" /><line x1="10" y1="8" x2="19" y2="8" /><line x1="10" y1="16" x2="19" y2="16" />
  </svg>
);

const linkIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

function MdButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(120,120,120,0.18)'; e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
      style={{
        minWidth: 32,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: '0.95rem',
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function VideoMetadataEditorInner({ video, onClose, onSaved }: Props) {
  const [description, setDescription] = useState(video.description || '');
  const [equipment, setEquipment] = useState<string[]>(video.equipment || []);
  const [trainingType, setTrainingType] = useState<string[]>(video.training_type || []);
  const [bodyParts, setBodyParts] = useState<string[]>(video.body_parts || []);
  const [intensity, setIntensity] = useState<string>(video.intensity || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = useMetaLabels();
  const { t } = useTranslation();

  // Optional AI clean-up. Hidden unless the server reports a configured model.
  const aiAvailable = useAiAvailable();
  const [cleaning, setCleaning] = useState(false);
  // The text as it was before the last clean-up, so a result the user dislikes
  // is one click away from being undone rather than gone.
  const [beforeClean, setBeforeClean] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    setDescription(video.description || '');
    setEquipment(video.equipment || []);
    setTrainingType(video.training_type || []);
    setBodyParts(video.body_parts || []);
    setIntensity(video.intensity || '');
  }, [video]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Restore the caret/selection after a formatting action mutates the value.
  useEffect(() => {
    if (pendingSelection.current && textareaRef.current) {
      const [start, end] = pendingSelection.current;
      pendingSelection.current = null;
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(start, end);
    }
  });

  // Wrap the current selection with inline markers (e.g. **bold**).
  const applyWrap = (prefix: string, suffix: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = end > start ? description.slice(start, end) : placeholder;
    const next = description.slice(0, start) + prefix + selected + suffix + description.slice(end);
    setDescription(next);
    const selStart = start + prefix.length;
    pendingSelection.current = [selStart, selStart + selected.length];
  };

  // Prefix each selected line (e.g. "- ", "> ", "1. ") for block formatting.
  const applyLinePrefix = (prefixFor: (index: number) => string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = description.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = description.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = description.length;
    const transformed = description
      .slice(lineStart, lineEnd)
      .split('\n')
      .map((line, i) => prefixFor(i) + line)
      .join('\n');
    const next = description.slice(0, lineStart) + transformed + description.slice(lineEnd);
    setDescription(next);
    pendingSelection.current = [lineStart, lineStart + transformed.length];
  };

  // Insert a markdown link, selecting the "url" placeholder for quick editing.
  const insertLink = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const label = end > start ? description.slice(start, end) : 'text';
    const snippet = `[${label}](url)`;
    const next = description.slice(0, start) + snippet + description.slice(end);
    setDescription(next);
    const urlStart = start + label.length + 3;
    pendingSelection.current = [urlStart, urlStart + 3];
  };

  /**
   * Replace the description with a cleaned-up version.
   *
   * Nothing is saved here — the result lands in the textarea for the user to
   * read, edit or undo, and only reaches the library through the same Save
   * button as any hand-written description. Tags are untouched.
   */
  const handleClean = async () => {
    if (!description.trim()) return;
    setCleaning(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/clean-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clean-up failed');
      setBeforeClean(description);
      setDescription(data.description || '');
    } catch (err: any) {
      setError(err.message || 'Clean-up failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, equipment, training_type: trainingType, body_parts: bodyParts, intensity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="video-metadata-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="glass-card video-metadata-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 860,
          padding: '1.75rem',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--surface-color)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: '1.25rem' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Video Info</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {video.filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-hover)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Description</span>
          <div style={{ border: '1px solid var(--glass-border)', borderRadius: 12, background: 'var(--surface-hover)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--glass-border)' }}>
              <MdButton title="Bold (Ctrl/Cmd+B)" onClick={() => applyWrap('**', '**', 'bold text')}>
                <span style={{ fontWeight: 800 }}>B</span>
              </MdButton>
              <MdButton title="Italic (Ctrl/Cmd+I)" onClick={() => applyWrap('*', '*', 'italic text')}>
                <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</span>
              </MdButton>
              <MdButton title="Strikethrough" onClick={() => applyWrap('~~', '~~', 'strikethrough')}>
                <span style={{ textDecoration: 'line-through' }}>S</span>
              </MdButton>
              <MdButton title="Inline code" onClick={() => applyWrap('`', '`', 'code')}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{'</>'}</span>
              </MdButton>
              <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 5px', background: 'var(--glass-border)' }} />
              <MdButton title="Heading" onClick={() => applyLinePrefix(() => '## ')}>
                <span style={{ fontWeight: 800 }}>H</span>
              </MdButton>
              <MdButton title="Bulleted list" onClick={() => applyLinePrefix(() => '- ')}>{listIcon}</MdButton>
              <MdButton title="Numbered list" onClick={() => applyLinePrefix(i => `${i + 1}. `)}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700 }}>1.</span>
              </MdButton>
              <MdButton title="Quote" onClick={() => applyLinePrefix(() => '> ')}>{quoteIcon}</MdButton>
              <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 5px', background: 'var(--glass-border)' }} />
              <MdButton title="Link" onClick={insertLink}>{linkIcon}</MdButton>

              {/* Sits at the end of the toolbar, past the divider, because it
                  rewrites the whole field rather than formatting a selection. */}
              {aiAvailable && (
                <>
                  <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 5px', background: 'var(--glass-border)' }} />
                  <button
                    type="button"
                    title={t('ai.clean_hint')}
                    onClick={handleClean}
                    disabled={cleaning || !description.trim()}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--glass-border)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: cleaning || !description.trim() ? 'default' : 'pointer',
                      opacity: cleaning || !description.trim() ? 0.5 : 1,
                      fontSize: '0.78rem',
                    }}
                  >
                    {cleaning ? t('ai.cleaning') : t('ai.clean_btn')}
                  </button>
                  {beforeClean !== null && !cleaning && (
                    <button
                      type="button"
                      onClick={() => { setDescription(beforeClean); setBeforeClean(null); }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--glass-border)',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '0.78rem',
                      }}
                    >
                      {t('ai.clean_undo')}
                    </button>
                  )}
                </>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                  const key = e.key.toLowerCase();
                  if (key === 'b') { e.preventDefault(); applyWrap('**', '**', 'bold text'); }
                  else if (key === 'i') { e.preventDefault(); applyWrap('*', '*', 'italic text'); }
                }
              }}
              placeholder="Notes about this video — focus areas, difficulty, etc."
              rows={8}
              style={{
                display: 'block',
                width: '100%',
                minHeight: 200,
                padding: '14px 16px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-family)',
                fontSize: '1rem',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
          <span style={{ display: 'block', marginTop: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Supports Markdown formatting.
          </span>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 10, fontSize: '0.9rem' }}>Equipment</span>
          <EquipmentPicker selected={equipment} onChange={setEquipment} />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Training Type</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TRAINING_TYPES.map(t => {
                  const sel = trainingType.includes(t);
                  return (
                    <button key={t} onClick={() => setTrainingType(sel ? trainingType.filter(x => x !== t) : [...trainingType, t])} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.trainingType(t)}>
                      <TrainingTypeIcon type={t} />
                      <span style={{ fontSize: '0.95rem' }}>{labels.trainingType(t)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Intensity</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['low','medium','high'].map(level => {
                  const sel = intensity === level;
                  return (
                    <button key={level} onClick={() => setIntensity(sel ? '' : level)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.intensity(level)}>
                      <IntensityIcon level={level} />
                      <span style={{ fontSize: '0.95rem', textTransform: 'capitalize' }}>{labels.intensity(level)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Body Parts</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {BODY_PARTS.map(bp => {
              const selected = bodyParts.includes(bp);
              return (
                <button key={bp} onClick={() => setBodyParts(selected ? bodyParts.filter(b => b !== bp) : [...bodyParts, bp])} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: selected ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.bodyPart(bp)}>
                  <BodyPartIcon part={bp} />
                  <span style={{ fontSize: '0.95rem' }}>{labels.bodyPart(bp)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--rest-color)', fontSize: '0.9rem', marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid var(--glass-border)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn"
            style={{ padding: '10px 20px', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default function VideoMetadataEditor(props: Props) {
  if (typeof document === 'undefined') return <VideoMetadataEditorInner {...props} />;
  return createPortal(<VideoMetadataEditorInner {...props} />, document.body);
}
