# Changelog

All notable changes to MyFitnessPlan are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-08-01

### ⚠️ Upgrade notes

- **Database migrations run automatically** on first launch. No manual steps.
- **YouTube videos need an internet connection.** Any plan containing them is marked
  "Needs internet" and cannot be done offline. Videos from your own library are
  unaffected and still play with no connection.
- **Imported videos survive library scans.** A scan only reconciles files on disk, so
  it no longer touches anything imported from YouTube.

### Added

**YouTube playlists**

- Paste a link to a YouTube playlist and it becomes its own album in your library.
  Videos can be tagged, filtered, searched and put into plans exactly like your own
  files — they simply have no file on disk and play through YouTube's own player,
  ads included.
- The playlist must be **Public or Unlisted**; YouTube blocks private playlists, and
  the import dialog says so up front.
- Imported albums can be renamed and deleted. Renaming is display-only, so re-importing
  a playlist keeps the name you gave it.
- Re-importing refreshes titles, durations and thumbnails, and never overwrites tags
  or descriptions you have edited yourself.
- **Descriptions are fetched from YouTube** in the background after the import. They
  arrive a little later than the videos do, and a progress pill in the Library shows
  how many are still on the way.
- **Tags are guessed from the video title** — equipment, training type, body parts and
  intensity, in English and Polish. It understands negation, so "trening bez hantli"
  is not tagged as needing dumbbells. Everything it guesses can be corrected by hand.
- Plans can **mix your own videos and YouTube ones** freely in the same day.

**Library**

- An empty library now shows two album placeholders instead of a blank page: one that
  takes you to Settings to scan your videos, and one that imports a YouTube playlist.
- The "Add from YouTube" placeholder stays afterwards, so adding another playlist feels
  like adding another album.
- A **source filter** — All / My files / YouTube — in the Library and the plan builder.
- YouTube albums and videos carry a YouTube badge.

**Plans**

- The plan builder can import a playlist without leaving the builder, and can narrow the
  video list to just what was imported.
- Plans containing YouTube videos show a **"Needs internet"** warning on their card.
- A **Previous day** button in the builder, alongside Next day. Both moved directly
  under the day being edited and are now text buttons rather than solid ones.

**Appearance**

- A **Watermelon** theme: green rind background, flesh-pink accents, seed speckling and
  rind-green rest days.

### Changed

- Video titles in the plan builder are no longer boxed in cards or truncated. Long
  titles wrap to as many lines as they need, since the title is often the only thing
  distinguishing one workout from the next.

### Fixed

- An album cover picked on the album page did not appear until you navigated away and
  back; it now updates immediately.
- The album cover "Remove image" button never did anything and has been removed.

### Removed

- The album cover "Remove image" button (it did not work).

### Internal

- `videos` gains `source`, `external_id`, `external_url`, `external_playlist_id` and
  `external_playlist_title`, all added by idempotent migrations at startup.
- New endpoints under `/api/external`: `status`, `import`, `descriptions-status`,
  `backfill-descriptions`, and `playlist/:id` (rename, delete, usage).
- `GET /api/plan` now reports `has_external` per plan.
- Library scans and the plan matcher are scoped to local videos, so neither can delete
  or re-bind an imported one.
- yt-dlp is downloaded from its GitHub releases at build time, verified against the
  published SHA-256, and shipped alongside ffmpeg. It is only used to read playlist
  metadata, never to download media. Everything that knows it exists lives in
  `server/src/external/`, with removal instructions in `external/index.ts`.

## [1.3.0] - 2026-07-31

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
- README screenshots were refreshed to match the current UI.

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
- **Windows video playback and folder paths.** Serving local videos no longer
  breaks on Windows path separators; directory selection and related path handling
  were hardened for the desktop build.

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

## [1.2.0] - 2026-07-18

### Added

**Desktop**

- A packaged **Electron** app for macOS and Windows, with its own staging pipeline
  and GitHub Actions desktop build. The web/self-hosted flow still works the same.

**Workout log**

- A **Log** page for workout history: activity calendar, range summaries, and
  breakdowns by training type, body part, equipment and intensity.
- **Log a past workout** by hand — name it, optionally attach library videos, and
  save it alongside plan completions. Manual entries can be removed later.

**Plans**

- Plans can take a **background image**, with an optional **blur** toggle so the
  artwork stays behind the content without fighting the text.

**Library**

- Friendlier search and filtering across the library and plan builder (tokenised
  matching over titles and metadata).

### Changed

- UI and Polish/English locale polish across Plans, Player, Album and the metadata
  editor.
- About content was trimmed as Profile/Log took over history and insights.

## [1.1.3] - 2026-07-06

### Added

**Plans**

- **Build your own plan** in the app: pick videos day by day, set a name and start
  date, walk a workout/rest pattern, and save — no spreadsheet required. Existing
  plans can still be imported from CSV/TSV, and built plans can be edited later.
- The builder supports search plus filters for equipment, training type, intensity
  and body parts, in grid or list view.

**Library**

- Richer video metadata: **training type**, **body parts** and **intensity**, next
  to equipment and description.
- A **video details** modal for reading and editing that metadata from the library
  and player flows.

### Internal

- `videos` gains `training_type`, `body_parts` and `intensity` via startup
  migrations.
- Plan create/edit APIs grow to support the in-app builder.

## [1.1.2] - 2026-06-14

### Added

**Library**

- Browse your video collection **inside the app** as albums (folders), open an
  album page, and play from there — not only via the scheduled player.
- **Video cards** with thumbnails, plus an editor for description and **equipment**
  tags (with a dedicated equipment picker).

**Docs**

- A full **Polish README** (`README.pl.md`) and a language link from the English
  README.

### Fixed

- Album and library sorting quirks when browsing larger collections.

### Internal

- `videos` gains `description` and `equipment` via startup migrations.
- Early Electron asset scaffolding appeared here; the shipping desktop wrapper
  landed properly in 1.2.0.

## [1.0.0] - 2026-05-08

### Added

Initial public release of **MyFitnessPlan** — a local, self-hosted workout planner
built around your own video files.

- Import workout plans from **CSV/TSV** spreadsheets (including multiple videos per
  day).
- Point Settings at a **local video directory**, scan it, and exclude folders you
  do not want.
- Define a flexible **workout/rest pattern** (not locked to Mon–Sun weeks).
- **Dashboard**, **calendar**, built-in **player**, and mark-as-done progress
  tracking with smart matching from spreadsheet names to files on disk.
- Multiple plans you can switch between; activate one at a time.
- Themes (Midnight, Snow, Sunset, Forest, Pastel Orange, Pastel Pink, Sky Blue)
  and **English / Polish** UI.
- Runs entirely on your machine — no cloud account and no subscription.

[1.4.0]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v1.4.0
[1.3.0]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v1.3.0
[1.2.0]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v1.2.0
[1.1.3]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v.1.1.3
[1.1.2]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v.1.1.2
[1.0.0]: https://github.com/Klodizaur/MyFitnessPlan/releases/tag/v1.0.0
