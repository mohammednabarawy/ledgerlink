import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return false;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

function resolveEnvPaths() {
  if (app.isPackaged) {
    return [
      path.join(app.getPath('userData'), '.env'),
      path.join(path.dirname(process.execPath), '.env'),
    ];
  }
  return [path.join(PROJECT_ROOT, '.env')];
}

/** Load .env into process.env (does not override existing env vars). */
export function loadEnv() {
  for (const envPath of resolveEnvPaths()) {
    if (parseEnvFile(envPath)) return;
  }
}

export function ensureUserEnvTemplate() {
  if (!app.isPackaged) return;

  const userEnv = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(userEnv)) return;

  const templatePath = path.join(process.resourcesPath, 'env.example');
  if (!fs.existsSync(templatePath)) return;

  fs.mkdirSync(path.dirname(userEnv), { recursive: true });
  fs.copyFileSync(templatePath, userEnv);
}
