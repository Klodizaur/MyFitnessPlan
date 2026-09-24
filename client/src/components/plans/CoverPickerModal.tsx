import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import Modal, { CloseButton } from '../modal/Modal';
import type { Video } from '../../types/video';

interface Props {
  planName: string;
  /** The cover the plan has now, if any. */
  currentUrl: string | null;
  blurred: boolean;
  loading: boolean;
  /** This plan's videos that have a thumbnail to pick from. */
  videos: Video[];
  uploading: boolean;
  onClose: () => void;
  onPick: (thumbnailPath: string) => void;
  onUpload: (file: File) => void;
  onBlur: (blur: boolean) => void;
  onRemove: () => void;
}

/** Change a plan's cover: one of its own videos' pictures, or an image of your own. */
export default function CoverPickerModal(props: Props) {
  const { planName, currentUrl, blurred, loading, videos, uploading, onClose } = props;
  const { t } = useTranslation();
  const [tab, setTab] = useState<'thumbnail' | 'upload'>('thumbnail');

  return (
    <Modal width={640} onClose={onClose} busy={uploading} label={t('plans.set_background')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title" style={{ fontSize: 22 }}>{t('plans.set_background')}</h2>
          <div className="md-sub">{planName}</div>
        </div>
        <CloseButton onClick={onClose} disabled={uploading} />
      </div>

      <div className="md-body" style={{ gap: 16 }}>
        <div className="rx-seg cv-tabs">
          <button type="button" className={tab === 'thumbnail' ? 'is-on' : ''} onClick={() => setTab('thumbnail')}>{t('plans.choose_from_library')}</button>
          <button type="button" className={tab === 'upload' ? 'is-on' : ''} onClick={() => setTab('upload')}>{t('plans.upload_image')}</button>
        </div>

        {currentUrl && (
          <div className="cv-current">
            <img src={currentUrl} alt="" />
            <div className="cv-current-actions">
              <button type="button" className="cv-switch" aria-pressed={blurred} onClick={() => props.onBlur(!blurred)}>
                <span className={`lib-scope-track${blurred ? ' is-on' : ''}`}><span className="lib-scope-knob" /></span>
                {t('plans.blur_background')}
              </button>
              <button type="button" className="cv-remove" onClick={props.onRemove}>
                <Trash2 size={15} />{t('plans.remove_background')}
              </button>
            </div>
          </div>
        )}

        {tab === 'thumbnail' ? (
          loading ? (
            <p className="md-text">{t('plans.details_loading')}</p>
          ) : videos.length === 0 ? (
            <p className="md-text">{t('plans.builder_no_videos')}</p>
          ) : (
            <div className="cv-grid">
              {videos.map(video => {
                const on = Boolean(currentUrl && video.thumbnail_path && currentUrl.endsWith(video.thumbnail_path));
                return (
                  <button
                    key={video.id}
                    type="button"
                    className={`cv-thumb${on ? ' is-on' : ''}`}
                    title={video.filename}
                    onClick={() => props.onPick(video.thumbnail_path as string)}
                  >
                    <img src={`/thumbnails/${video.thumbnail_path}`} alt={video.filename} loading="lazy" />
                    {on && <span className="cv-check"><Check size={14} /></span>}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <label className={`cv-drop${uploading ? ' is-busy' : ''}`}>
            <ImagePlus size={26} />
            <strong>{uploading ? t('plans.builder_saving') : t('plans.cover_drop_title')}</strong>
            <span>{t('plans.cover_drop_note')}</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) props.onUpload(f);
              }}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
