/**
 * Ask "are you sure?" without `window.confirm`.
 *
 * The browser's own confirm is unstyled, and in a desktop shell it can be
 * suppressed entirely — the call returns false and the action just silently does
 * nothing. This resolves a promise from a styled dialog instead. A <ConfirmHost />
 * mounted in the app shell shows it.
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get a red confirm button. */
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export const CONFIRM_EVENT = 'mfp:confirm';

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(CONFIRM_EVENT, { detail: { ...options, resolve } }));
  });
}
