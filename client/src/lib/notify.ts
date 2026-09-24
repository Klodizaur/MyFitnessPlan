/**
 * Pop-up notices for things that happen out of sight of the control that caused
 * them — a failed background job, a request that came back with an error.
 *
 * Anything can call `notify(...)`; one <Toaster /> mounted in the app shell shows
 * it. That keeps errors out of `window.alert` and out of unstyled text.
 */
export type NoticeKind = 'error' | 'ok';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

const EVENT = 'mfp:notify';
let nextId = 1;

export function notify(message: string, kind: NoticeKind = 'error') {
  window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: { id: nextId++, kind, message } }));
}

export const NOTIFY_EVENT = EVENT;
