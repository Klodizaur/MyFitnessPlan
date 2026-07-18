/**
 * Stage everything the packaged app needs into desktop/.build/, which
 * electron-builder then ships as extraResources:
 *
 *   .build/client/dist  -> the built React UI (served via the app:// protocol)
 *   .build/server       -> compiled server (dist) + package.json + PRODUCTION
 *                          node_modules, with better-sqlite3 rebuilt for Electron
 *   .build/ffmpeg       -> a static ffmpeg binary (for thumbnail generation)
 *
 * Native modules are rebuilt for the SAME OS/arch this script runs on, which is
 * why Windows installers must be built on Windows (see the CI workflow).
 */
import { execSync } from 'node:child_process';
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

console.log('\n== Staging complete ==');
