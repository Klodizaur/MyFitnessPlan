# MyFitnessPlan v1.5.0

Two plans at once, each on its own rhythm — plus a permanent record of the plans you finish.

## Highlights

### 🏃 Run two plans side by side

A plan can now be activated as your **main plan** or as an **extra plan** running alongside it. A short mobility or core block no longer has to replace your main programme.

The Calendar gains tabs when both slots are filled, and the Dashboard pages between them with arrows — banner, progress and upcoming all follow whichever plan you're looking at.

### 🗓️ Every plan on its own rhythm

The workout/rest cycle moves from one global setting to **per plan**, so a five-day strength plan and an every-other-day mobility plan can run together without fighting over one schedule.

It's an override, not a replacement: a plan follows your Settings pattern unless you choose *Set for this plan*. Change the Settings pattern and every plan still following it moves with it.

### 📋 Plan details, with the plan's actions in one place

Click a plan and you get its full picture — category, start date, description, equipment — plus the plan laid out **day by day**, each day a card with the same slider the calendar uses when a day holds several videos.

Activate, deactivate, edit, **duplicate** and delete all live there too, so looking at a plan and acting on it aren't two separate trips.

### 🏆 Finished plans are kept for good

Completing a plan is now **recorded permanently** — name, finish date, how many days it took, how many workouts. The record survives editing or deleting the plan itself.

A plan counts as finished when *every* one of its workout days is marked, in whatever order you did them.

### 🤖 The AI builder asks for workout days, not weeks

Asking for "4 weeks" could produce a plan a fraction of that length: the model padded each week with rest days, and empty days are discarded when a plan is saved.

It now asks for a **number of workout days** and requests a flat list of sessions from the model, stating plainly that the app inserts rest itself. The number you pick is the number of sessions you get — and if your library can't stretch that far, the builder says how many it managed instead of leaving you to count.

## Also new

- **Plan descriptions** — what a plan is for, shown on its card and in its details. AI drafts pre-fill it with the structure the model chose.
- **Tags on calendar previews** — intensity, training type, body parts and equipment as chips under each day's thumbnail. Overflowing `+2` chips expand on click.
- **Album covers in the AI builder**, replacing text chips, using the same artwork as your Library.
- **Guided AI form** (Settings → AI): one question per screen instead of all at once. The existing single-page form stays the default.
- **New equipment tags**: Barbell, Step, Bench, No Equipment.
- **Body-part icons** are now one drawn set — the same figure each time with the relevant part filled in, instead of a generic person icon for all ten.

## Log

- Workouts marked done in the player can finally be **removed from the log**. Previously only hand-added entries had a Remove button. Removing one also clears its ✓ from the plan.
- New **Plans finished** stat and a **Plan progress** panel, split into Finished and In progress.
- The month stat counts **active days** rather than workouts logged, and follows the month you're viewing in the calendar.

## Fixed

- The Dashboard hero's background image tiled instead of filling the card after paging to the other plan.
- A long workout title ran underneath the Dashboard hero's floating thumbnail at most window widths.
- Uploading a CSV/TSV plan no longer deactivates your extra plan — it claims the main slot only.

## Upgrading

Safe to install over your current version. The database gains one table and two columns, all additive; existing plans, schedules and history are untouched, and no plan changes its rhythm until you give it one. Plans you'd already finished are detected and recorded on first run.

Desktop app data lives in the per-user data directory, which installing over the app never touches.
