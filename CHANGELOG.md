# Changelog

All notable changes to MyFitnessPlan are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-08-01

### ⚠️ Upgrade notes

- **Rescan your library after updating.** Videos now store their runtime, which is
  read from the file itself. Until you press **Scan** in Settings, the new "Total
  time" statistic reads `—` and thumbnails show no duration badge. The scan does one
  quick pass per video; afterwards it only probes files it hasn't measured before.
- **Database migrations run automatically** on first launch. No manual steps.
- **The "Snow" theme was removed.** Anyone using it is moved to "Midnight" on first
  launch.

### Added

**Plans**

- The active plan now appears as a full-bleed featured card above the rest, showing
  its background image, category, start date, workout count and the equipment its
  videos need.
- Every plan card lists how many workouts it contains and which equipment it uses,
  shown as tags.
- Plans can be given a **category** — Reduction, Strength, Cardio, Mobility,
  Endurance, Flexibility, or a custom label you type yourself. Categories are picked
  in the plan builder and can be changed by editing a plan.
- The plan list is grouped under category headings, each with a count. Headings only
  appear once at least one plan has a category.

**Dashboard**

- A banner shows the active plan's name, how many of its workouts are done, and how
  many days remain — with the last day called out.
- When a plan reaches its end, the dashboard congratulates you, reports how many of
  its workouts you completed, and offers to start a new one. Plans no longer just
  stop with no explanation.
- Plans with a future start date show when they begin instead of an empty dashboard.

**Workout log**

- Entries completed as part of a plan carry a **Plan: <name>** badge, so past
  workouts can be traced back to the plan they belonged to.
- Workouts can be annotated with **notes** — how it went, weights, reps, how you
  felt. Notes are written in the expanded day view and shown there.
- A **Total time** statistic joins the existing counters, summing the runtime of
  everything logged. Its label states when the figure is partial, since manually
  logged workouts have no video and contribute no time.

**Player**

- Videos played straight from the Library — outside any plan — can now be marked as
  done, and are saved to the workout log like any other entry. Marking can be undone.

**Library**

- Video thumbnails show a runtime badge in the corner (`32:15`, or `1:04:20` for
  longer videos).
- Scanning the library shows a progress bar with the number of videos processed, a
  percentage, and the file currently being read.

**About**

- Added a link to the project website, myfitnessplan.bigdeckit.com.

### Changed

- **Plan builder — video browser redesigned.** Cards are thumbnail-first: a large
  16:9 preview, the title, and a round add button in the corner. File paths, the
  "Selected" label and file extensions are gone, and the grid is denser, so browsing
  a large library is calmer.
- **Plan builder — the day list marks your position.** The day being edited holds
  its place in the list as a labelled divider, separating earlier days from later
  ones, and follows the selection as it changes.
- Credits now read **Klaudia Krzos** throughout, including the desktop build's
  copyright notice and installer metadata, with LinkedIn and GitHub links.
- Selecting a video in the builder no longer nudges the grid by a pixel.

### Fixed

- **Multi-video days no longer collapse into one clump of titles.** In the workout
  log's calendar and expanded view, and in the dashboard's upcoming list, each video
  is shown as its own item.
- **The expanded log view listed every video scheduled that day, not the ones you
  actually completed.** A day where you finished 2 of 8 videos showed all 8. It now
  shows only what was marked done.
- **The "Plan:" badge was unreadable in the pastel themes.** It used the theme accent
  as its text color, which in the Pastel Orange, Pastel Pink and Sky Blue themes is a
  light pastel on a tint of itself. Text now uses the primary color in every theme.
- **The active plan's start date was unreadable in the orange theme**, for the same
  reason. All text on the featured card now sits white on a dark scrim, independent
  of the palette.
- **The plan builder showed "Week 1 - Day 1" in English regardless of language.**
  Week and day headings were baked in when a plan was created; they are now derived
  at display time and follow the interface language.

### Removed

- The **Snow** theme. Six themes remain.

### Internal

- `workout_plans` gains `category`; `workout_log` gains `notes`; `videos` gains
  `duration_seconds`. All added by idempotent migrations at startup.
- New endpoints: `GET /api/library/scan-progress`, `PUT /api/profile/history/notes`.
- `GET /api/plan` now returns each plan's workout count and combined equipment, and
  sorts the active plan first.
- Video durations are read via `ffmpeg -i` rather than `ffprobe`, because only
  `ffmpeg` ships with the packaged desktop app.

[1.3.0]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v1.3.0
