import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Smartphone, Tv, WifiOff } from 'lucide-react';

/**
 * Settings → Devices: Share on Local Network (the tray's switch, here too), and
 * how to open the app on a phone, tablet or TV once it's on.
 *
 * Only the desktop app can switch sharing, so this tab exists only there: the
 * preload bridge (desktop/preload.js) is what `sharingBridge()` looks for.
 * Browsers on phones, tablets and the TV app never see it.
 */

type Sharing = { enabled: boolean; running: boolean; url: string | null; external: boolean };
type SharingBridge = { get: () => Promise<Sharing>; set: (enabled: boolean) => Promise<Sharing> };

export function sharingBridge(): SharingBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { myFitnessPlan?: { sharing?: SharingBridge } }).myFitnessPlan?.sharing ?? null;
}

/** Port the TV app assumes when none is typed (tv/…/ServerAddress.kt). */
const TV_DEFAULT_PORT = '7777';

export default function DevicesSection() {
  const { t } = useTranslation();
  const bridge = sharingBridge();
  const [state, setState] = useState<Sharing | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    bridge?.get().then(setState).catch(() => setState(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The QR code library is only fetched here, when the tab is open.
  useEffect(() => {
    const url = state?.url;
    if (!url) { setQr(''); return; }
    let cancelled = false;
    // Always dark on light, whatever the theme: phone cameras can't be relied
    // on to read an inverted code.
    import('qrcode')
      .then(m => m.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }))
      .then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQr(''); });
    return () => { cancelled = true; };
  }, [state?.url]);

  if (!bridge) return null;

  const setSharing = async (enabled: boolean) => {
    if (busy || state?.enabled === enabled) return;
    setBusy(true);
    try {
      // Switching restarts the server, which reloads this window back onto
      // this tab; the answer only arrives when it didn't have to.
      setState(await bridge.set(enabled));
    } catch {
      // The window reloaded mid-call.
    } finally {
      setBusy(false);
    }
  };

  const address = state?.url ? new URL(state.url) : null;
  const phoneAddress = address ? `${address.hostname}:${address.port}` : '';
  const tvAddress = address ? (address.port === TV_DEFAULT_PORT ? address.hostname : phoneAddress) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`http://${phoneAddress}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access; the address is on screen to type anyway.
    }
  };

  const noAddress = state?.enabled && state.running && !state.url;
  const waiting = (
    <p className="dv-waiting">
      {noAddress ? <><WifiOff size={16} />{t('settings.devices_no_network')}</> : t('settings.devices_need_sharing')}
    </p>
  );

  return (
    <div className="st-stack">
      <section className="st-card st-card--inline">
        <header>
          <h2>{t('settings.devices_share_title')}</h2>
          <p>{t('settings.devices_share_msg')}</p>
          {state?.external && <p className="dv-warn">{t('settings.devices_external')}</p>}
        </header>
        <div className="rx-seg" aria-busy={busy}>
          <button type="button" className={state && !state.enabled ? 'is-on' : ''} disabled={busy || !state || state.external} onClick={() => setSharing(false)}>
            {t('settings.devices_off')}
          </button>
          <button type="button" className={state?.enabled ? 'is-on' : ''} disabled={busy || !state || state.external} onClick={() => setSharing(true)}>
            {busy ? t('settings.devices_switching') : t('settings.devices_on')}
          </button>
        </div>
      </section>

      <section className="st-card">
        <header className="dv-head">
          <Smartphone size={18} />
          <div>
            <h2>{t('settings.devices_phone_title')}</h2>
            <p>{t('settings.devices_phone_msg')}</p>
          </div>
        </header>
        {address ? (
          <div className="dv-phone">
            {qr && <img className="dv-qr" src={qr} alt={t('settings.devices_qr_alt', { address: phoneAddress })} />}
            <div className="dv-address-block">
              <span className="dv-address">http://{phoneAddress}</span>
              <button type="button" className="rx-btn" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? t('settings.devices_copied') : t('settings.devices_copy')}
              </button>
            </div>
          </div>
        ) : waiting}
      </section>

      <section className="st-card">
        <header className="dv-head">
          <Tv size={18} />
          <div>
            <h2>{t('settings.devices_tv_title')}</h2>
            <p>{t('settings.devices_tv_msg')}</p>
          </div>
        </header>
        {address ? <span className="dv-address dv-address--tv">{tvAddress}</span> : waiting}
      </section>
    </div>
  );
}
