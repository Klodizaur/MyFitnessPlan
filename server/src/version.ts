/**
 * The running app's version. The packaged desktop wrapper injects
 * MYFITNESSPLAN_VERSION; outside it we fall back to this package's own version.
 * Shared so /api/version and a plan export stamp the same number.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const appVersion: string = (() => {
  if (process.env.MYFITNESSPLAN_VERSION) return process.env.MYFITNESSPLAN_VERSION;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
