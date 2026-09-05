/**
 * MyFitnessPlan - Desktop wrapper
 * -------------------------------
 * Two run modes, chosen automatically:
 *
 *   DEV  (app.isPackaged === false)
 *     - Drives the existing `npm run dev` (server on :3000 + Vite on :5173).
 *     - Window loads the Vite dev server (http://localhost:5173).
 *     - Reuses an already-running dev instance instead of starting a second.
 *
 *   PACKAGED (app.isPackaged === true)  -> what ships in the installers
 *     - Grabs a GUARANTEED-FREE port, then runs the COMPILED server on
 *       127.0.0.1:<port> via utilityProcess.fork (Electron's bundled Node).
 *     - The server serves the built UI from that SAME origin, so the client's
 *       relative URLs always hit the right port. No hardcoded port, no CORS, and
 *       no chance of hijacking / being hijacked by whatever is on port 3000.
 *     - cwd is the writable per-user data dir; a bundled ffmpeg is put on PATH.
 *
 * Either mode can additionally be SHARED on the local network from the tray, so
 * a phone or tablet on the same Wi-Fi can open the app. Sharing is off until it
 * is switched on, is remembered between runs, and is the only thing that ever
 * binds anything but loopback.
 *
 * The existing app is driven, never duplicated. All app-source changes it relies
 * on are additive and env-guarded (see server/src/index.ts).
 */

const {
  app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, utilityProcess, ipcMain, clipboard,
} = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const fs = require('fs');

// --- Mode / config -----------------------------------------------------------
const isPackaged = app.isPackaged;
const SELFTEST = process.env.POC_SELFTEST === '1';
// GitHub repo used by the lightweight "Check for Updates" feature.
const GITHUB_REPO = 'Klodizaur/MyFitnessPlan';

// Local-network sharing. Off by default: the server binds loopback only, exactly
// as it always has, until the user turns this on from the tray.
//
// A fixed port matters here in a way it does not for loopback. The address is
// something you type into a phone by hand, and a random port would hand you a
// different one after every restart. If it is taken we fall back to a free port
// rather than refusing to start, and the tray always shows the real address.
const LAN_PORT = 7777;

// Dev-only
const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_DEV_PORT = 5173;
const DEV_PORT = 3000; // `npm run dev` server port
const CLIENT_DEV_URL = 'http://localhost:5173';
const DEV_SERVER_PROBE = `http://127.0.0.1:${DEV_PORT}/api/settings`;
const CLIENT_DEV_PROBE = 'http://127.0.0.1:5173';

// Packaged resource paths
function serverEntry() { return path.join(process.resourcesPath, 'server', 'dist', 'index.js'); }
function clientDir() { return path.join(process.resourcesPath, 'client', 'dist'); }
function ffmpegDir() { return path.join(process.resourcesPath, 'ffmpeg'); }
function ytdlpDir() { return path.join(process.resourcesPath, 'yt-dlp'); }

const TRAY_ICON = path.join(__dirname, 'assets', 'tray-icon.png');

// --- State -------------------------------------------------------------------
let tray = null;
let mainWindow = null;
let devProc = null;          // DEV: `npm run dev` child (process group)
let serverChild = null;      // PACKAGED: utilityProcess running the compiled server
let serverState = 'stopped'; // 'stopped' | 'starting' | 'running'
let reusedExternal = false;  // DEV: attached to an already-running instance
let currentPort = null;      // PACKAGED: the port the window loads from
let logStream = null;
let shareOnNetwork = false;  // serve to other devices on the LAN (tray toggle)

// --- Desktop preferences (tray settings that outlive a run) ------------------
// Kept in its own small file rather than in the app database: this decides how
// the server is *started*, so it has to be readable before the server exists.
function configPath() { return path.join(app.getPath('userData'), 'desktop-config.json'); }

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; }
  catch (e) { return {}; }
}

function saveConfig(patch) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
  } catch (e) { log('Could not save desktop config:', e.message); }
}

// --- Helpers -----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  const line = `[desktop] ${a.map(String).join(' ')}`;
  console.log(line);
  if (logStream) { try { logStream.write(line + '\n'); } catch (e) { /* ignore */ } }
}

/** Returns true if something answers on the URL. */
function probe(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

/**
 * A port nothing else is on.
 *
 * `preferred` is tried first and quietly given up on if it is taken, which is
 * what LAN sharing wants: a stable address you can type into a phone, without
 * ever failing to start just because something else grabbed the number.
 * `host` matters too — a port free on loopback is not necessarily free on the
 * network interface we are about to bind.
 */
function findFreePort(preferred, host = '127.0.0.1') {
  const tryPort = (port) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.on('error', () => resolve(null));
    srv.listen(port, host, () => {
      const actual = srv.address().port;
      srv.close(() => resolve(actual));
    });
  });

  return (async () => {
    if (preferred) {
      const got = await tryPort(preferred);
      if (got) return got;
      log(`Port ${preferred} is in use; falling back to a free one.`);
    }
    const any = await tryPort(0);
    if (!any) throw new Error('No free port available');
    return any;
  })();
}

// --- Local network -----------------------------------------------------------
/**
 * This machine's address on the local network, or null when it has none.
 *
 * Interfaces are ranked rather than just filtered: a laptop routinely has a
 * handful of IPv4 addresses (Wi-Fi, Ethernet, a VPN, Docker, a VM bridge) and
 * only one of them is the one a phone on the same Wi-Fi can reach. Ordinary
 * private ranges on a real Wi-Fi/Ethernet interface come first; 169.254.x
 * link-local addresses mean "no network" and are dropped entirely.
 */
function lanAddress() {
  const scored = [];
  const interfaces = os.networkInterfaces() || {};
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      // Node <18 reported `family` as a number; accept both spellings.
      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (!isV4 || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue; // self-assigned: unreachable
      const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr.address);
      const isPhysical = /^(en|eth|wl|wlan)\d/.test(name);
      // Docker/VM bridges are private too, so being on a real adapter is what
      // separates "the address your phone can use" from the rest.
      scored.push({ address: addr.address, score: (isPrivate ? 2 : 0) + (isPhysical ? 1 : 0) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].address : null;
}

/** The address to open on another device, or null when there is nothing to share. */
function shareUrl() {
  const ip = lanAddress();
  if (!ip) return null;
  // Packaged: the server serves the UI itself. Dev: the UI is Vite's, on its own port.
  const port = isPackaged ? currentPort : CLIENT_DEV_PORT;
  return port ? `http://${ip}:${port}/` : null;
}

/** Server environment: ensure the bundled ffmpeg and yt-dlp are found first, plus extras. */
function serverEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  env.MYFITNESSPLAN_VERSION = app.getVersion(); // shown in the app's Settings via /api/version
  const parts = [];
  // ytdlpDir() is only here to be found on PATH; drop it to stop shipping yt-dlp.
  if (isPackaged) parts.push(ffmpegDir(), ytdlpDir());
  else parts.push('/opt/homebrew/bin', '/usr/local/bin');
  env.PATH = [...parts, env.PATH || ''].filter(Boolean).join(path.delimiter);
  return env;
}

async function waitForServer(port, retries = 60, delayMs = 500) {
  const url = `http://127.0.0.1:${port}/api/settings`;
  for (let i = 0; i < retries; i++) {
    if (await probe(url)) return true;
    await sleep(delayMs);
  }
  return false;
}

async function waitForDevReady(retries = 80, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    const [s, c] = await Promise.all([probe(DEV_SERVER_PROBE), probe(CLIENT_DEV_PROBE)]);
    if (s && c) return true;
    await sleep(delayMs);
  }
  return false;
}

// --- First-run data migration (packaged only) --------------------------------
function migrateDataIfEmpty(userDataDir) {
  try {
    const dataDir = path.join(userDataDir, 'data');
    if (fs.existsSync(path.join(dataDir, 'workout-planner.db'))) return;
    const candidates = [process.env.MYFITNESSPLAN_SEED_DIR, path.join(process.resourcesPath, 'seed-data')].filter(Boolean);
    const seed = candidates.find((c) => c && fs.existsSync(path.join(c, 'workout-planner.db')));
    if (!seed) { log('No seed data; starting with a fresh database.'); return; }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.cpSync(seed, dataDir, { recursive: true });
    log('Migrated existing data from', seed, '->', dataDir);
  } catch (e) {
    log('Data migration skipped:', e.message);
  }
}

// --- Server lifecycle --------------------------------------------------------
async function startServer() {
  if (serverState === 'running' || serverState === 'starting') { openApp(); return; }
  serverState = 'starting';
  updateTray();
  const ok = isPackaged ? await startPackagedServer() : await startDevServer();
  if (ok) {
    serverState = 'running';
    log('Server is ready' + (isPackaged ? ' on port ' + currentPort : '') + '.');
    updateTray();
    const hadWindow = !!mainWindow;
    openApp();
    // After a restart the port may have changed; repoint the existing window.
    if (hadWindow && mainWindow) mainWindow.loadURL(currentUrl());
  } else {
    serverState = 'stopped';
    updateTray();
    if (!SELFTEST) {
      dialog.showErrorBox('Server did not start',
        'The MyFitnessPlan server could not be started. See the log for details:\n' +
        (logStream ? path.join(app.getPath('userData'), 'desktop.log') : '(console)'));
    }
  }
}

async function startDevServer() {
  if (await probe(DEV_SERVER_PROBE)) {
    reusedExternal = true;
    log('An app is already running on :' + DEV_PORT + ' - reusing it (will not stop it).');
    return true;
  }
  reusedExternal = false;
  log('Starting the existing app via `npm run dev` in', REPO_ROOT);
  devProc = spawn('npm', ['run', 'dev'], {
    cwd: REPO_ROOT,
    // Vite binds localhost unless told otherwise; this is what lets the dev UI be
    // reached from a phone without changing the default `npm run dev` behaviour.
    env: serverEnv(shareOnNetwork ? { MYFITNESSPLAN_LAN: '1' } : {}),
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devProc.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
  devProc.stderr.on('data', (d) => process.stderr.write(`[app] ${d}`));
  devProc.on('error', (err) => {
    log('Failed to launch `npm run dev`:', err.message);
    devProc = null; serverState = 'stopped'; updateTray();
    dialog.showErrorBox('Could not start the server', `Running "npm run dev" failed:\n\n${err.message}`);
  });
  devProc.on('exit', (code, signal) => {
    log(`app process exited (code=${code}, signal=${signal})`);
    devProc = null;
    if (serverState === 'running') { serverState = 'stopped'; updateTray(); }
  });
  return await waitForDevReady();
}

async function startPackagedServer() {
  const userData = app.getPath('userData');
  migrateDataIfEmpty(userData);
  fs.mkdirSync(path.join(userData, 'data'), { recursive: true });

  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    log('ERROR: server entry not found at', entry);
    dialog.showErrorBox('Server missing', `Could not find the bundled server at:\n${entry}`);
    return false;
  }

  // Sharing changes both halves of the bind: the interface (so other devices can
  // reach it at all) and the port (so the address stays the same between runs).
  const host = shareOnNetwork ? '0.0.0.0' : '127.0.0.1';
  const preferredPort = shareOnNetwork ? LAN_PORT : 0;

  for (let attempt = 1; attempt <= 4; attempt++) {
    let port;
    try { port = await findFreePort(preferredPort, host); }
    catch (e) { log('findFreePort failed:', e.message); await sleep(300); continue; }
    currentPort = port;
    log(`Starting compiled server on ${host}:${port} (attempt ${attempt}, cwd=${userData})`);

    const child = utilityProcess.fork(entry, [], {
      cwd: userData,
      env: serverEnv({
        PORT: String(port),
        // Loopback unless the user asked to share: binding every interface is
        // what raises the firewall prompt and what puts the app on the network.
        HOST: host,
        MYFITNESSPLAN_CLIENT_DIR: clientDir(),   // serve the built UI same-origin
        NODE_ENV: 'production',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'myfitnessplan-server',
    });
    serverChild = child;
    child.stdout?.on('data', (d) => log('[server]', d.toString().trim()));
    child.stderr?.on('data', (d) => log('[server:err]', d.toString().trim()));
    child.on('exit', (code) => {
      log('Server process exited with code', code);
      if (serverChild === child) {
        serverChild = null;
        if (serverState === 'running') { serverState = 'stopped'; updateTray(); }
      }
    });

    const ready = await Promise.race([
      waitForServer(port),
      new Promise((res) => child.once('exit', () => res(false))),
    ]);
    if (ready === true) return true;

    log(`Attempt ${attempt} did not come up; retrying on a new port.`);
    try { child.kill(); } catch (e) { /* ignore */ }
    if (serverChild === child) serverChild = null;
  }
  return false;
}

/** Kill a child process AND its descendants (dev: concurrently -> tsx/vite). */
function killTree(proc) {
  return new Promise((resolve) => {
    if (!proc || !proc.pid) return resolve();
    const pid = proc.pid;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(pid), '/T', '/F']); } catch (e) { /* ignore */ }
      setTimeout(finish, 4000);
      return;
    }
    try { process.kill(-pid, 'SIGTERM'); }
    catch (e) { try { proc.kill('SIGTERM'); } catch (e2) { /* ignore */ } }
    setTimeout(() => {
      if (!done) {
        try { process.kill(-pid, 'SIGKILL'); }
        catch (e) { try { proc.kill('SIGKILL'); } catch (e2) { /* ignore */ } }
        finish();
      }
    }, 4000);
  });
}

async function stopServer() {
  if (reusedExternal) {
    log('Server was started outside this app - leaving it running.');
    reusedExternal = false; serverState = 'stopped'; updateTray();
    return;
  }
  if (isPackaged) {
    if (serverChild) { const c = serverChild; serverChild = null; try { c.kill(); } catch (e) { /* ignore */ } }
    serverState = 'stopped'; updateTray();
    return;
  }
  if (!devProc) { serverState = 'stopped'; updateTray(); return; }
  log('Stopping the app process...');
  const p = devProc; devProc = null;
  await killTree(p);
  serverState = 'stopped'; updateTray();
}

async function restartServer() {
  log('Restarting the server...');
  await stopServer();
  await sleep(1200);
  await startServer();
}

// --- Import an existing database (for users upgrading from the pre-desktop app) ---
/** The data directory the currently-running server reads from. */
function currentDataDir() {
  return isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(REPO_ROOT, 'server', 'data');
}

/** Cheap sanity check that a file is actually a SQLite database. */
function isSqliteFile(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return n >= 16 && buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch (e) { return false; }
}

async function importDatabase() {
  // We must be able to stop the server to replace its open DB file safely.
  if (reusedExternal) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Import Database',
      message: 'Quit the separately-running server first.',
      detail: 'This window is attached to a MyFitnessPlan server that was started outside the app, so it can\u2019t safely replace its database. Quit that server (or use the installed app) and try again.',
    });
    return;
  }

  const pick = await dialog.showOpenDialog({
    title: 'Import existing MyFitnessPlan database',
    message: 'Select your existing workout-planner.db',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite database', extensions: ['db'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (pick.canceled || !pick.filePaths || pick.filePaths.length === 0) return;

  const srcDb = pick.filePaths[0];
  const srcDir = path.dirname(srcDb);
  const dataDir = currentDataDir();
  const targetDb = path.join(dataDir, 'workout-planner.db');

  if (!isSqliteFile(srcDb)) {
    dialog.showErrorBox('Not a database', 'That file does not look like a SQLite database (workout-planner.db).');
    return;
  }
  if (path.resolve(srcDb) === path.resolve(targetDb)) {
    dialog.showErrorBox('Already in use', 'That is already the database this app is using.');
    return;
  }

  if (fs.existsSync(targetDb)) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Replace'],
      defaultId: 0,
      cancelId: 0,
      title: 'Replace current data?',
      message: 'Replace the desktop app data with the imported database?',
      detail: 'Your current plans, library and history in the desktop app will be overwritten, and this cannot be undone. Thumbnails and plan backgrounds next to the selected database are imported too, if present.',
    });
    if (response !== 1) return;
  }

  const wasRunning = serverState === 'running';
  log('Importing database from', srcDb);
  try {
    await stopServer();
    fs.mkdirSync(dataDir, { recursive: true });
    // Remove any stale DB + WAL sidecars first, then copy the source set across
    // (copying -wal/-shm preserves un-checkpointed changes).
    for (const suffix of ['', '-wal', '-shm']) {
      const t = targetDb + suffix;
      if (fs.existsSync(t)) fs.rmSync(t);
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const s = srcDb + suffix;
      if (fs.existsSync(s)) fs.copyFileSync(s, targetDb + suffix);
    }
    // Bring over sibling asset folders if present (merge with any existing).
    for (const sub of ['thumbnails', 'plan-backgrounds']) {
      const s = path.join(srcDir, sub);
      if (fs.existsSync(s) && fs.statSync(s).isDirectory()) {
        fs.cpSync(s, path.join(dataDir, sub), { recursive: true });
      }
    }
  } catch (e) {
    log('Import failed:', e.message);
    dialog.showErrorBox('Import failed', e.message);
    if (wasRunning) await startServer();
    return;
  }

  await startServer(); // restarts (fresh port) and repoints the window
  await dialog.showMessageBox({
    type: 'info',
    title: 'Import complete',
    message: 'Your data was imported.',
    detail: 'MyFitnessPlan restarted with your imported database.',
  });
}

// --- Check for updates (lightweight; no code signing required) ---------------
// Asks GitHub for the latest release and, if it's newer than this build, opens
// the release page to download. Installing over the current app keeps all user
// data (it lives in userData, which reinstalling never touches).
function isNewerVersion(latest, current) {
  // Strip any leading non-digit prefix so tags like "v1.2.3", "v.1.2.3" or
  // "release-1.2.3" all normalise to "1.2.3".
  const parse = (v) => String(v).trim().replace(/^[^0-9]*/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const headers = { 'User-Agent': 'MyFitnessPlan-Updater', Accept: 'application/vnd.github+json' };
  return new Promise((resolve, reject) => {
    const collect = (res) => {
      const status = res.statusCode || 0;
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (status !== 200) return reject(new Error('HTTP ' + status));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    };
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, { headers }, collect).on('error', reject);
      } else {
        collect(res);
      }
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Request timed out')));
  });
}

async function checkForUpdates() {
  const current = app.getVersion();
  log('Checking for updates (current ' + current + ')...');
  try {
    const rel = await fetchLatestRelease();
    const latest = (rel.tag_name || '').replace(/^[^0-9]*/, '');
    const pageUrl = rel.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`;
    if (latest && isNewerVersion(latest, current)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Later', 'Download'],
        defaultId: 1,
        cancelId: 0,
        title: 'Update available',
        message: `MyFitnessPlan ${latest} is available.`,
        detail: `You have ${current}. Installing the new version over this one keeps all your data - your plans, library and history are stored separately and are never removed by updating.`,
      });
      if (response === 1) shell.openExternal(pageUrl);
    } else {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        title: 'You\u2019re up to date',
        message: `You have the latest version (${current}).`,
      });
    }
  } catch (e) {
    log('Update check failed:', e.message);
    if (String(e.message).includes('404')) {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        title: 'No updates',
        message: 'No published releases were found yet.',
        detail: `You have ${current}.`,
      });
      return;
    }
    await dialog.showMessageBox({
      type: 'warning',
      buttons: ['OK'],
      title: 'Could not check for updates',
      message: 'The update check could not be completed.',
      detail: `${e.message}\n\nYou can check manually at:\nhttps://github.com/${GITHUB_REPO}/releases`,
    });
  }
}

// --- Window ------------------------------------------------------------------
function currentUrl() {
  return isPackaged ? `http://localhost:${currentPort}/` : CLIENT_DEV_URL;
}

/** Native folder picker for Settings (video library / exclude paths). */
ipcMain.handle('pick-directory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const opts = {
    title: 'Select folder',
    properties: ['openDirectory', 'createDirectory'],
  };
  const pick = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (pick.canceled || !pick.filePaths || pick.filePaths.length === 0) return null;
  return pick.filePaths[0];
});

function openApp() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const url = currentUrl();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#0f172a',
    title: 'MyFitnessPlan',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  log('Loading window:', url);
  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.webContents.once('did-fail-load', (_e, code, desc, u) => log('Window failed to load:', code, desc, u));
  mainWindow.on('closed', () => { mainWindow = null; }); // keep running in tray
}

// --- Sharing on the local network --------------------------------------------
/**
 * Turn LAN sharing on or off. The bind address is fixed when the server starts,
 * so the change only takes effect on a restart — which this does, rather than
 * leaving the tray claiming something the running server is not doing.
 */
async function setShareOnNetwork(enabled) {
  if (enabled === shareOnNetwork) return;
  shareOnNetwork = enabled;
  saveConfig({ shareOnNetwork: enabled });
  log(enabled ? 'Enabling local network sharing.' : 'Disabling local network sharing.');
  updateTray();

  // Dev mode reusing a server somebody else started can't be rebound from here.
  if (reusedExternal) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Restart the server to apply',
      message: enabled ? 'Sharing is on, but this server was started outside the app.' : 'Sharing is off for the next server start.',
      detail: 'This window is attached to a MyFitnessPlan server that was already running, so the app can\u2019t change how it is listening. Quit that server and let the app start its own.',
    });
    return;
  }

  if (serverState === 'running' || serverState === 'starting') await restartServer();
  updateTray();
  if (enabled && serverState === 'running') await showShareAddress();
}

/**
 * Show the address to type on a phone or tablet, with the caveats that actually
 * matter: same network, and everyone on it can reach the app.
 */
async function showShareAddress() {
  if (!shareOnNetwork) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Sharing is off',
      message: 'Turn on "Share on Local Network" first.',
      detail: 'Until then MyFitnessPlan listens only on this computer.',
    });
    return;
  }

  const url = shareUrl();
  if (!url) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'No network address',
      message: 'This computer doesn\u2019t have a local network address right now.',
      detail: 'Connect it to your Wi-Fi or Ethernet network and open this again.',
    });
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Copy Address', 'Done'],
    defaultId: 0,
    cancelId: 1,
    title: 'Open MyFitnessPlan on another device',
    message: url,
    detail:
      'Type that into Safari or Chrome on your iPhone or iPad. The device has to be on the same Wi-Fi as this computer.\n\n' +
      'In Safari, Share \u2192 Add to Home Screen gives you an icon that opens it like an app.\n\n' +
      'While sharing is on, anyone on this network who knows the address can open your library \u2014 there is no password. ' +
      'Turn it off from the tray when you are done.\n\n' +
      'macOS may ask whether to allow incoming connections the first time; it has to be allowed for this to work.',
  });
  if (response === 0) {
    clipboard.writeText(url);
    log('Copied share address to the clipboard:', url);
  }
}

// --- Tray --------------------------------------------------------------------
function trayImage() {
  let img = nativeImage.createFromPath(TRAY_ICON);
  if (img.isEmpty()) { log('WARNING: tray icon not found at', TRAY_ICON); return img; }
  return img.resize({ width: 18, height: 18 });
}

function updateTray() {
  if (!tray) return;
  const running = serverState === 'running';
  const starting = serverState === 'starting';
  const status = starting ? 'Server: starting...' : running ? 'Server: running' : 'Server: stopped';
  const sharedAt = shareOnNetwork && running ? shareUrl() : null;
  tray.setToolTip(`MyFitnessPlan - ${status}` + (sharedAt ? `\nShared at ${sharedAt}` : ''));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    ...(sharedAt ? [{ label: sharedAt, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open App', click: () => openApp() },
    { label: 'Import Database...', enabled: !starting, click: () => importDatabase() },
    { type: 'separator' },
    {
      label: 'Share on Local Network',
      type: 'checkbox',
      checked: shareOnNetwork,
      enabled: !starting,
      click: (item) => setShareOnNetwork(item.checked),
    },
    { label: 'Local Network Address...', enabled: shareOnNetwork && running, click: () => showShareAddress() },
    { type: 'separator' },
    { label: 'Start Server', enabled: !running && !starting, click: () => startServer() },
    { label: 'Stop Server', enabled: running || starting, click: () => stopServer() },
    { label: 'Restart Server', enabled: running || starting, click: () => restartServer() },
    { type: 'separator' },
    { label: 'Check for Updates...', click: () => checkForUpdates() },
    { label: 'Quit', click: () => quitApp() },
  ]));
}

async function quitApp() {
  log('Quitting...');
  await stopServer();
  app.quit();
}

// --- App lifecycle -----------------------------------------------------------
// Single-instance lock: a second launch focuses the existing window instead of
// starting a second server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openApp());

  app.whenReady().then(async () => {
    if (isPackaged) {
      try { logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'desktop.log'), { flags: 'a' }); }
      catch (e) { /* ignore */ }
    }
    log(`Launching (${isPackaged ? 'packaged' : 'dev'} mode)`);
    // Dev-only: give the unpackaged Electron process our dock icon on macOS.
    // (The packaged .app already gets the correct icon + name from electron-builder;
    //  the dev dock/menu-bar NAME still shows "Electron" - that's the Electron binary.)
    if (!isPackaged && process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (e) { /* ignore */ }
    }
    shareOnNetwork = loadConfig().shareOnNetwork === true;
    if (shareOnNetwork) log('Local network sharing is on (remembered from last run).');
    tray = new Tray(trayImage());
    updateTray();

    await startServer();

    if (SELFTEST) {
      log('SELFTEST: verifying UI + same-origin API...');
      await sleep(4000);
      if (mainWindow) {
        try {
          const title = await mainWindow.webContents.executeJavaScript('document.title');
          log('SELFTEST document.title =', JSON.stringify(title));
          const api = await mainWindow.webContents.executeJavaScript(
            "fetch('/api/settings').then(r => r.ok ? ('API_OK ' + r.status) : ('API_BAD ' + r.status)).catch(e => 'API_ERR ' + e.message)"
          );
          log('SELFTEST same-origin API =', api);
          const ver = await mainWindow.webContents.executeJavaScript(
            "fetch('/api/version').then(r => r.json()).then(d => d.version).catch(e => 'ERR ' + e.message)"
          );
          log('SELFTEST /api/version =', ver);
        } catch (e) { log('SELFTEST eval error:', e.message); }
      } else {
        log('SELFTEST: no window was created');
      }
      await sleep(1200);
      await quitApp();
    }
  });

  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('activate', () => openApp());

  process.on('exit', () => {
    if (devProc && devProc.pid && process.platform !== 'win32') {
      try { process.kill(-devProc.pid, 'SIGKILL'); } catch (e) { /* ignore */ }
    }
  });
}
