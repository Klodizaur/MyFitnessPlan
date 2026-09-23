# UI redesign — progress and conventions

Working notes for the full-app redesign on `feature/ui-redesign`. Delete this
file when the redesign is finished and merged.

## The design source

`redesign_handoff_myfitnessplan/` (gitignored — 17MB of prototypes and image
crops). Read `README.md` there first: it has the design tokens, the global
patterns and a section per screen. Each `XxxApp.dc.html` holds the markup with
inline styles (exact px/hex values) plus a `class Component` with the mock data
and interaction logic. **The source is the ground truth for anything the README
doesn't say.**

Its palette is the **Pastel Orange** theme; Settings still offers all seven.

## Done

| Screen | Files |
|---|---|
| Foundation | `styles/tokens.css`, `styles/shell.css`, `components/AppShell.tsx`, `lib/useIsMobile.ts` |
| Dashboard | `pages/Dashboard.tsx`, `styles/dashboard.css` |
| Library index | `pages/Library.tsx`, `components/library/*`, `styles/library.css` |
| Folder view | `pages/Album.tsx` (shares the Library components) |
| Plan builder | `components/builder/PlanBuilderScreen.tsx`, `styles/builder.css` |

## Left to do

Plans · Calendar (Tape/Week/Grid) · Settings · AI plan builder · Plan preview
modal · Log · Library modals (video details, add details, YouTube import, plan
import, backup) · Player.

Screens not yet migrated are wrapped in `<Legacy>` in `App.tsx`, which keeps
the old page container. Remove the wrapper as each one is done.

## Conventions

- **Tokens only.** No raw hex in screen CSS — use `--t-*` from `tokens.css` so
  all seven themes work. Status colours (done/danger/freeze/plan badges, the
  four tag categories) are deliberately fixed across themes.
- **Shared primitives** live in `shell.css` (`.rx-btn`, `.rx-card`, `.rx-tag`,
  `.rx-badge`, `.rx-dur`, `.rx-progress`, `.rx-seg`, `.rx-yt-badge`).
  Screen-specific CSS goes in its own file.
- **Tags:** `lib/videoTags.ts` fixes the order and the category. Read-only tags
  and selectable filter chips must stay visibly different.
- **i18n:** every string in `en.json` *and* `pl.json`. Counted strings need
  explicit `_one`/`_other` forms or you get "1 weeks".
- **Icons:** `lucide-react`. It has no brand icons — use
  `components/icons/YouTubeGlyph.tsx` for YouTube.
- **Mobile is 767px.** `useIsMobile()` for structural differences, media
  queries for styling.

## Gotchas already hit

- The old stylesheet styles bare elements (`nav`, and more). Its rules leak
  into new markup and can out-specify a single class. Check computed styles
  when something is mysteriously misplaced.
- A `<button>` centres its content vertically, so a stretched grid card drops
  its thumbnail. Card buttons must be `display: flex; flex-direction: column`.
- Don't nest a page's `.rx-wrap` inside another — it double-pads.
- The schedule API returns a bare thumbnail filename; prefix `/thumbnails/`.

## Open decisions

- The builder still has a **start date** field, which the handoff moves to the
  Plans "start plan" sheet. Remove it when Plans is built.
- The folder header lost the **custom album cover picker**; stored covers still
  show. The handoff's header has no control for it.
- `BuilderQuickAdd` was removed — the builder's always-open picker replaces it.
- The other six themes' token values were derived, not specified.

## Testing

Never point a dev server at `server/data/` — copy the DB to a scratch dir:

```bash
cp server/data/workout-planner.db* /tmp/rx/data/
cp -R server/data/thumbnails /tmp/rx/data/
npm run build
(cd /tmp/rx && PORT=3999 HOST=127.0.0.1 \
  MYFITNESSPLAN_CLIENT_DIR=$PWD/client/dist \
  node $PWD/server/dist/index.js &)
```

Check every screen at **1280** and **390**, in a light and a dark theme, and
measure rather than eyeball: page overflow, element alignment, computed colours.
