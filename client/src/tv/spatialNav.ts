import { runTvKeyInterceptors } from '../lib/tv';

/**
 * Arrow-key (D-pad) focus movement for TV mode.
 *
 * Browsers only move focus with Tab, which a remote doesn't have. This picks the
 * nearest focusable thing in the pressed direction by geometry, the way a TV
 * launcher does, so no screen needs to describe its own layout.
 *
 * - While a dialog, sheet or popover is open, focus stays inside it.
 * - Clickable cards and calendar cells that aren't buttons (they have a pointer
 *   cursor but no tabindex) are made focusable, and OK clicks them.
 * - Text fields keep Left/Right for the caret until it reaches an edge, and
 *   sliders (range inputs, the seek bar) keep Left/Right for their value.
 * - With nothing further in that direction, Up/Down scroll the page instead, so
 *   long text can still be read.
 */

const NATIVE_FOCUSABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[role="button"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="option"]',
  '[role="menuitem"]',
].join(',');

/**
 * Pointer targets that must never hold focus: full-area click catchers behind
 * dialogs and over the video.
 */
const NEVER_ADOPT = '.pv-hit, .md-overlay, .md-card, [class*="backdrop"], [class*="scrim"]';

/** Things OK/Enter already activates without our help. */
const ACTIVATES_ON_ENTER = 'a[href], button, input, select, textarea, summary';

/** Open overlays, topmost last. Focus is kept inside the last visible one. */
const OVERLAY = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '.pl-sheet',
  '.lib-sheet',
  '.pb-sheet',
].join(',');

type Dir = 'up' | 'down' | 'left' | 'right';
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  return !el.closest('[inert], [aria-hidden="true"]');
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

/**
 * Give pointer-only click targets (cards, calendar cells) a tabindex so they can
 * hold focus. Only the outermost element of a pointer region counts — children
 * inherit the cursor — and anything already inside a focusable is left alone.
 */
function adoptClickables(root: ParentNode): void {
  const all = root.querySelectorAll<HTMLElement>('div, li, span, article, section, img, td, tr');
  for (const el of all) {
    if (el.hasAttribute('tabindex') || el.matches(NEVER_ADOPT)) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const parent = el.parentElement;
    if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
    if (el.closest(NATIVE_FOCUSABLE) !== null) continue;
    el.tabIndex = 0;
    el.dataset.tvAdopted = '';
  }
}

/** The container focus must stay in: the topmost open overlay, or the page. */
export function focusScope(): HTMLElement {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY)).filter(isVisible);
  return overlays[overlays.length - 1] || document.body;
}

export function focusables(scope: HTMLElement = focusScope()): HTMLElement[] {
  adoptClickables(scope);
  return Array.from(scope.querySelectorAll<HTMLElement>(NATIVE_FOCUSABLE)).filter(el =>
    el.tabIndex >= 0 &&
    !isDisabled(el) &&
    // A YouTube frame would swallow every key after it; the remote drives the
    // player from our own controls instead.
    el.tagName !== 'IFRAME' &&
    isVisible(el)
  );
}

/**
 * Distance from `from` to `to` in direction `dir`, or null when `to` isn't in
 * that direction. Lower wins. Being in line (overlapping on the other axis)
 * matters far more than being close, so a row of buttons is walked in order
 * rather than jumping to something diagonally nearer.
 */
function score(from: DOMRect, to: DOMRect, dir: Dir): number | null {
  const EPS = 1;
  let major: number;
  let minorGap: number;
  let centerOffset: number;
  if (dir === 'left' || dir === 'right') {
    const ahead = dir === 'right'
      ? to.left >= from.right - EPS || (to.left > from.left + EPS && to.right > from.right + EPS && to.left + to.width / 2 > from.right)
      : to.right <= from.left + EPS || (to.right < from.right - EPS && to.left < from.left - EPS && to.left + to.width / 2 < from.left);
    if (!ahead) return null;
    major = dir === 'right' ? Math.max(0, to.left - from.right) : Math.max(0, from.left - to.right);
    minorGap = Math.max(0, Math.max(from.top, to.top) - Math.min(from.bottom, to.bottom));
    centerOffset = Math.abs((to.top + to.bottom) / 2 - (from.top + from.bottom) / 2);
  } else {
    const ahead = dir === 'down'
      ? to.top >= from.bottom - EPS || (to.top > from.top + EPS && to.bottom > from.bottom + EPS && to.top + to.height / 2 > from.bottom)
      : to.bottom <= from.top + EPS || (to.bottom < from.bottom - EPS && to.top < from.top - EPS && to.top + to.height / 2 < from.top);
    if (!ahead) return null;
    major = dir === 'down' ? Math.max(0, to.top - from.bottom) : Math.max(0, from.top - to.bottom);
    minorGap = Math.max(0, Math.max(from.left, to.left) - Math.min(from.right, to.right));
    centerOffset = Math.abs((to.left + to.right) / 2 - (from.left + from.right) / 2);
  }
  // Out of line: heavily penalised, so it only wins when nothing is in line.
  const outOfLine = minorGap > 0 ? 10000 + minorGap * 4 : 0;
  return outOfLine + major * 2 + centerOffset * 0.25;
}

function best(from: HTMLElement, dir: Dir, list: HTMLElement[], rect: DOMRect = from.getBoundingClientRect()): HTMLElement | null {
  let winner: HTMLElement | null = null;
  let winnerScore = Infinity;
  for (const el of list) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const s = score(rect, el.getBoundingClientRect(), dir);
    if (s !== null && s < winnerScore) {
      winner = el;
      winnerScore = s;
    }
  }
  return winner;
}

/**
 * Full-screen areas: while focus is inside one, it stays exactly filling the
 * screen (the player's video) instead of scrolling to centre the button.
 */
const PINNED = '.pv-theater';

/**
 * A card with its own buttons on it (a calendar day with Play and part arrows,
 * a library video with its heart): Up/Down from the card step onto those
 * buttons above or below its middle, while Left/Right keep moving between
 * cards. "On it" is by position, so buttons layered over a card count too.
 */
function intoCard(card: HTMLElement, dir: Dir, scope: HTMLElement): HTMLElement | null {
  if (dir !== 'up' && dir !== 'down') return null;
  const r = card.getBoundingClientRect();
  const onCard = focusables(scope).filter(el => {
    if (el === card) return false;
    const e = el.getBoundingClientRect();
    return e.left >= r.left - 1 && e.right <= r.right + 1 && e.top >= r.top - 1 && e.bottom <= r.bottom + 1;
  });
  if (onCard.length === 0) return null;
  const middle = new DOMRect(r.left, r.top + r.height / 2, r.width, 0);
  let winner: HTMLElement | null = null;
  let winnerScore = Infinity;
  for (const el of onCard) {
    const s = score(middle, el.getBoundingClientRect(), dir);
    if (s !== null && s < winnerScore) { winner = el; winnerScore = s; }
  }
  return winner;
}

/** Keep the focused element comfortably on screen, not pinned to an edge. */
export function reveal(el: HTMLElement): void {
  const pinned = el.closest<HTMLElement>(PINNED);
  if (pinned) {
    pinned.scrollIntoView({ block: 'start' });
    return;
  }
  const rect = el.getBoundingClientRect();
  const margin = 48;
  const offscreen = rect.top < margin || rect.bottom > window.innerHeight - margin ||
    rect.left < 0 || rect.right > window.innerWidth;
  // Horizontal strips (the player's workout strip, calendar tapes) scroll
  // themselves; the page only needs to follow vertically.
  el.scrollIntoView({ block: offscreen ? 'center' : 'nearest', inline: 'nearest' });
}

export function focusElement(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  reveal(el);
}

/** Where focus goes when there is none: a screen's marked default, else its first control. */
export function defaultFocus(scope: HTMLElement = focusScope()): HTMLElement | null {
  const list = focusables(scope);
  const marked = list.find(el => el.hasAttribute('data-tv-default'));
  if (marked) return marked;
  if (scope === document.body) {
    // Prefer the screen's content over the nav bar, and something on screen now.
    const main = list.filter(el => el.closest('main'));
    const inView = main.filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    if (main.length === 0 && Date.now() - screenShownAt < 1500) return null; // content still loading
    // A text field is a poor first stop: OK on it opens the TV's keyboard.
    const notTyping = (el: HTMLElement) => !el.matches('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea');
    return inView.find(notTyping) || inView[0] || main[0] || list[0] || null;
  }
  return list[0] || null;
}

/** The focusable closest to where focus just was. */
function nearestTo(rect: DOMRect, scope: HTMLElement): HTMLElement | null {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let winner: HTMLElement | null = null;
  let winnerDist = Infinity;
  for (const el of focusables(scope)) {
    const r = el.getBoundingClientRect();
    // Staying on the same row matters more than raw distance.
    const d = Math.hypot(r.left + r.width / 2 - cx, (r.top + r.height / 2 - cy) * 2);
    if (d < winnerDist) { winner = el; winnerDist = d; }
  }
  return winner;
}

// When the current screen appeared: a screen that loads its content after the
// first draw gets a moment before focus settles on the nav bar instead.
let screenShownAt = Date.now();
let screenPath = window.location.pathname;

// Where focus last was, and on which screen: lost focus is put back near it.
let lastEl: HTMLElement | null = null;
let lastRect: DOMRect | null = null;
let lastPath = '';
// A button disabled while it works (saving "done") usually comes straight back:
// focus steps next door meanwhile, and returns if nobody has moved it since.
let comeBack: { el: HTMLElement; movedTo: HTMLElement; until: number } | null = null;

/** Where focus should go when it has been lost on this screen. */
function recoveryTarget(scope: HTMLElement): HTMLElement | null {
  if (lastRect && window.location.pathname === lastPath) {
    if (lastEl?.isConnected && scope.contains(lastEl) && !isDisabled(lastEl) && isVisible(lastEl)) return lastEl;
    const near = nearestTo(lastRect, scope);
    if (near) return near;
  }
  return defaultFocus(scope);
}

function hasFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && el !== document.body && el.isConnected && isVisible(el));
}

/** Text fields keep Left/Right for moving the caret until it reaches an edge. */
function keyBelongsToField(el: HTMLElement, dir: Dir): boolean {
  // Multi-line text: the arrows move the caret, and only leave the field from
  // its very start (Up/Left) or very end (Down/Right) — an empty one lets go at once.
  if (el instanceof HTMLTextAreaElement) {
    const atStart = (el.selectionStart ?? 0) === 0 && (el.selectionEnd ?? 0) === 0;
    const atEnd = (el.selectionEnd ?? 0) >= el.value.length;
    return dir === 'up' || dir === 'left' ? !atStart : !atEnd;
  }
  // A slider (the player's seek bar) uses Left/Right for its value.
  if (el.getAttribute('role') === 'slider') return dir === 'left' || dir === 'right';
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'range') return dir === 'left' || dir === 'right';
  if (dir === 'up' || dir === 'down') return false;
  const textLike = ['text', 'search', 'url', 'email', 'password', 'tel', ''].includes(el.type);
  if (!textLike) return false;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const len = el.value.length;
  return dir === 'left' ? start > 0 || end > 0 : end < len;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const isArrow = e.key in KEY_DIR;
  const isEnter = e.key === 'Enter';
  if (!isArrow && !isEnter) return;

  if (runTvKeyInterceptors(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  const scope = focusScope();
  const active = document.activeElement as HTMLElement | null;

  // Nothing focused yet (first key on a screen, or the focused thing vanished):
  // the first press only puts focus somewhere sensible.
  if (!hasFocus() || !scope.contains(active)) {
    const target = recoveryTarget(scope);
    if (target) {
      e.preventDefault();
      e.stopImmediatePropagation();
      focusElement(target);
    }
    return;
  }

  if (isEnter) {
    // Buttons and links click on Enter by themselves; adopted cards don't.
    if (active && !active.matches(ACTIVATES_ON_ENTER)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      active.click();
    }
    return;
  }

  const dir = KEY_DIR[e.key];
  if (active && keyBelongsToField(active, dir)) return;

  const next = active ? (intoCard(active, dir, scope) || best(active, dir, focusables(scope))) : null;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (next) {
    focusElement(next);
  } else if (scope === document.body && (dir === 'up' || dir === 'down')) {
    window.scrollBy({ top: (dir === 'down' ? 1 : -1) * window.innerHeight * 0.5, behavior: 'smooth' });
  }
}

/**
 * When the focused element disappears (a dialog closed, a screen changed, a
 * rest countdown ended), put focus back somewhere visible: the element that
 * opened the dialog if it's still there; next to where it was, when a button
 * on the same screen was disabled or redrawn; else the screen's default.
 */
function watchLostFocus(): void {
  let returnTo: HTMLElement | null = null;
  let lastScope: HTMLElement = document.body;
  // The last thing focused on the page itself, outside any dialog: where focus
  // goes back to when a dialog closes, even one that moved focus in by itself.
  let lastOnPage: HTMLElement | null = null;
  lastPath = window.location.pathname;
  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement;
    if (el && el !== document.body) {
      if (!el.closest(OVERLAY)) lastOnPage = el;
      lastEl = el;
      lastRect = el.getBoundingClientRect();
      lastPath = window.location.pathname;
    }
  });

  const settle = () => {
    if (window.location.pathname !== screenPath) {
      screenPath = window.location.pathname;
      screenShownAt = Date.now();
      window.setTimeout(queue, 1600); // settle again if nothing had loaded by then
    }
    const scope = focusScope();
    if (scope !== lastScope) {
      // Entering an overlay: remember where to come back to.
      if (lastScope === document.body && scope !== document.body) returnTo = lastOnPage;
      lastScope = scope;
      if (!hasFocus() || !scope.contains(document.activeElement)) {
        const target = scope === document.body && returnTo?.isConnected && isVisible(returnTo)
          ? returnTo
          : defaultFocus(scope);
        if (scope === document.body) returnTo = null;
        if (target) focusElement(target);
        return;
      }
    }
    if (comeBack) {
      const { el, movedTo, until } = comeBack;
      if (Date.now() > until || document.activeElement !== movedTo || !el.isConnected) {
        comeBack = null;
      } else if (!isDisabled(el) && isVisible(el)) {
        comeBack = null;
        focusElement(el);
        return;
      }
    }
    if (!hasFocus()) {
      const disabledHere = lastEl?.isConnected && isDisabled(lastEl) && window.location.pathname === lastPath ? lastEl : null;
      const target = recoveryTarget(scope);
      if (target) {
        focusElement(target);
        if (disabledHere) comeBack = { el: disabledHere, movedTo: target, until: Date.now() + 1500 };
      }
    }
  };

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; settle(); });
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('focusout', queue);
  window.addEventListener('popstate', queue);
}

export function installSpatialNav(): void {
  // Capture phase on window: ahead of every screen's own key handlers, so the
  // arrows always move focus and never also seek a video or scroll a list.
  window.addEventListener('keydown', onKeyDown, true);
  watchLostFocus();
}
