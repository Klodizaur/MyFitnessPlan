/** A frozen calendar day: the plan keeps running underneath, this just
 *  overrides what that day's card shows (see server/src/routes/schedule.ts). */
export type FreezeReason = 'unwell' | 'period' | 'freeze';

export const FREEZE_REASONS: FreezeReason[] = ['unwell', 'period', 'freeze'];

export const FREEZE_REASON_EMOJI: Record<FreezeReason, string> = {
  unwell: '🤒',
  period: '🩸',
  freeze: '❄️',
};

export function isFreezeReason(v: unknown): v is FreezeReason {
  return typeof v === 'string' && (FREEZE_REASONS as string[]).includes(v);
}
