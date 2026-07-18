# MyFitnessPlan - Desktop wrapper

Packages the existing MyFitnessPlan web app into an installable desktop application
(macOS `.dmg`, Windows `.exe`, Linux `AppImage`) with a menu-bar / system-tray icon.
It does not reimplement the app - it runs the existing compiled server and serves the
existing UI. Users need no Node.js, npm, or terminal.

## How it works

- On launch it grabs a **guaranteed-free port**, starts the compiled server on
  `127.0.0.1:<port>` (loopback only), and loads the window from that same origin.
  Because the UI is served by the server, the frontend's relative URLs always reach
  the right port - there is no fixed port to collide with and no way to accidentally
  attach to another app on port 3000.
- The native `better-sqlite3` module is rebuilt for Electron's ABI at package time.
- A static `ffmpeg` binary is bundled and put on the server's PATH, so video
  thumbnail generation works without ffmpeg installed on the user's machine.
- The tray menu offers: Open App, Start / Stop / Restart Server, Quit. Closing the
  window keeps the app running in the tray.
- A single-instance lock prevents a second copy from starting a second server.

## Requirements to build

- Node.js 20+
- Install dependencies once:
  ```bash
  npm install            # repo root: installs the client + server workspaces
  npm install            # in desktop/: installs Electron + build tooling
  ```

## Run in development

From `desktop/`:
```bash
npm start
```
This drives the existing `npm run dev` (server on :3000 + Vite on :5173) and opens a
window against the Vite dev server. If a dev server is already running it attaches to
it instead of starting a second one.

## Build installers

Native modules and ffmpeg **cannot be cross-compiled**, so each installer must be built
on its own OS.

| Target  | Command (run in `desktop/`) | Output               |
| ------- | --------------------------- | -------------------- |
| macOS   | `npm run dist:mac`          | `release/*.dmg`      |
| Windows | `npm run dist:win`          | `release/*.exe`      |
| Linux   | `npm run dist:linux`        | `release/*.AppImage` |

To build **both macOS and Windows** without a Windows machine, push a `v*` git tag (or
run the workflow manually) - `.github/workflows/build-desktop.yml` builds each on a
native GitHub Actions runner and uploads the installers as artifacts.

Builds are currently **unsigned**. For distribution to other people you'll want an
Apple Developer ID + notarization (macOS) and a code-signing certificate (Windows) to
avoid Gatekeeper / SmartScreen warnings.

## Where user data lives

The packaged app stores its database, thumbnails, and plan backgrounds in the OS
per-user data directory (writable, unlike the app bundle):

- macOS: `~/Library/Application Support/MyFitnessPlan/data`
- Windows: `%APPDATA%\MyFitnessPlan\data`
- Linux: `~/.config/MyFitnessPlan/data`

On first launch the data folder is empty and the app creates a fresh database.

### Bringing your existing data across

To keep the plans/library/history you built up while running `npm run dev`, copy your
existing data into the location above **before first launch**. Your dev data lives in
`server/data/` (database + `thumbnails/` + `plan-backgrounds/`). For example on macOS:
```bash
mkdir -p "$HOME/Library/Application Support/MyFitnessPlan/data"
cp -R server/data/* "$HOME/Library/Application Support/MyFitnessPlan/data/"
```

## Changes made to the app (and why they're safe for `npm run dev`)

To support dynamic ports and packaging without breaking the dev workflow, these
additive, environment-guarded changes were made to the app source:

- **Client** uses **relative URLs** (`/api/...`) instead of a hardcoded
  `http://localhost:3000`, so it talks to whatever origin serves it.
- **Vite dev proxy** forwards `/api`, `/thumbnails`, `/videos`, `/plan-backgrounds`
  to the dev server on port 3000, so relative URLs resolve during `npm run dev`.
- **Server** reads `PORT` / `HOST` from the environment (defaults `3000` / `0.0.0.0`)
  and, only when `MYFITNESSPLAN_CLIENT_DIR` is set, serves the built client. None of
  these env vars are set by `npm run dev`, so development behaviour is unchanged.
