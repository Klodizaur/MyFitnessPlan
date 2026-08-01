/**
 * Stage everything the packaged app needs into desktop/.build/, which
 * electron-builder then ships as extraResources:
 *
 *   .build/client/dist  -> the built React UI (served via the app:// protocol)
 *   .build/server       -> compiled server (dist) + package.json + PRODUCTION
 *                          node_modules, with better-sqlite3 rebuilt for Electron
 *   .build/ffmpeg       -> a static ffmpeg binary (for thumbnail generation)
 *   .build/yt-dlp       -> a standalone yt-dlp binary (for YouTube playlists)
 *
 * Native modules are rebuilt for the SAME OS/arch this script runs on, which is
 * why Windows installers must be built on Windows (see the CI workflow).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const ROOT = path.resolve(DESKTOP, '..');
const BUILD = path.join(DESKTOP, '.build');
const STAGE_SERVER = path.join(BUILD, 'server');
const STAGE_CLIENT = path.join(BUILD, 'client', 'dist');
const STAGE_FFMPEG = path.join(BUILD, 'ffmpeg');
const STAGE_YTDLP = path.join(BUILD, 'yt-dlp');

const electronVersion = require(path.join(DESKTOP, 'node_modules', 'electron', 'package.json')).version;
// Invoke @electron/rebuild via node + its CLI entry (cross-platform; the .bin
// shim name differs on Windows, so we call the JS directly).
const rebuildCli = path.join(DESKTOP, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}\n  (cwd=${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}
function ensure(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found at ${p}. Run the app build first.`);
}

console.log('== Staging build resources (electron ' + electronVersion + ') ==');
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(STAGE_SERVER, { recursive: true });
fs.mkdirSync(path.dirname(STAGE_CLIENT), { recursive: true });
fs.mkdirSync(STAGE_FFMPEG, { recursive: true });
fs.mkdirSync(STAGE_YTDLP, { recursive: true });

// 1) Built UI
ensure(path.join(ROOT, 'client', 'dist', 'index.html'), 'client build');
fs.cpSync(path.join(ROOT, 'client', 'dist'), STAGE_CLIENT, { recursive: true });
console.log('- client/dist staged');

// 2) Compiled server + its package.json (package.json provides "type":"module")
ensure(path.join(ROOT, 'server', 'dist', 'index.js'), 'server build');
fs.cpSync(path.join(ROOT, 'server', 'dist'), path.join(STAGE_SERVER, 'dist'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'server', 'package.json'), path.join(STAGE_SERVER, 'package.json'));
console.log('- server/dist + package.json staged');

// 3) Production dependencies for the server (isolated install, no workspace hoisting)
run('npm install --omit=dev --no-audit --no-fund --no-package-lock', STAGE_SERVER);

// 4) Rebuild native modules (better-sqlite3) against Electron's ABI
run(`node "${rebuildCli}" -v ${electronVersion} -m . -f`, STAGE_SERVER);

// 5) Bundle a static ffmpeg binary (the server shells out to `ffmpeg` for thumbnails)
const ffmpegSrc = require('ffmpeg-static');
ensure(ffmpegSrc, 'ffmpeg-static binary');
const ffmpegName = path.basename(ffmpegSrc); // 'ffmpeg' or 'ffmpeg.exe'
const ffmpegDest = path.join(STAGE_FFMPEG, ffmpegName);
fs.copyFileSync(ffmpegSrc, ffmpegDest);
if (process.platform !== 'win32') fs.chmodSync(ffmpegDest, 0o755);
console.log('- ffmpeg staged (' + ffmpegName + ')');

// 6) Bundle yt-dlp (the server shells out to `yt-dlp` to read YouTube playlists).
//
//    Downloaded straight from the project's GitHub releases rather than via an
//    npm wrapper: yt-dlp ships standalone, self-contained binaries per platform
//    (no Python needed on the user's machine) and needs updating often, so going
//    to the source keeps the shipped copy as fresh as the build.
//
//    ---------------------------------------------------------------------
//    To stop shipping yt-dlp, delete this whole block, the `.build/yt-dlp`
//    entry in electron-builder.yml, and the ytdlpDir() line in main.js. See
//    server/src/external/index.ts for the matching server-side removal.
//    ---------------------------------------------------------------------
//
//    Set YTDLP_VERSION to pin a release (e.g. "2025.01.15") instead of latest.
const YTDLP_ASSETS = {
  darwin: 'yt-dlp_macos',   // universal2, self-contained
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp_linux',
};

async function fetchBuffer(url, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download ${label}: HTTP ${res.status} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}

async function stageYtDlp() {
  const asset = YTDLP_ASSETS[process.platform];
  if (!asset) throw new Error(`No yt-dlp binary known for platform ${process.platform}`);

  const version = process.env.YTDLP_VERSION;
  const base = version
    ? `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

  console.log(`- downloading yt-dlp (${asset}, ${version || 'latest'})...`);
  const binary = await fetchBuffer(`${base}/${asset}`, 'yt-dlp binary');

  // This binary is shipped to end users, so verify it against the checksums
  // published alongside the release rather than trusting the transfer.
  const sums = (await fetchBuffer(`${base}/SHA2-256SUMS`, 'yt-dlp checksums')).toString('utf8');
  const expected = sums
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];

  if (!expected) throw new Error(`No published checksum for ${asset}; refusing to ship it`);

  const actual = createHash('sha256').update(binary).digest('hex');
  if (actual !== expected) {
    throw new Error(`yt-dlp checksum mismatch\n  expected ${expected}\n  got      ${actual}`);
  }

  // Written under the plain name because the server invokes `yt-dlp` on PATH.
  const destName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const dest = path.join(STAGE_YTDLP, destName);
  fs.writeFileSync(dest, binary);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);

  const mb = (binary.length / 1024 / 1024).toFixed(1);
  console.log(`- yt-dlp staged (${destName}, ${mb} MB, sha256 verified)`);
}

await stageYtDlp();

console.log('\n== Staging complete ==');
