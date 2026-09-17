import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from this file until we find the workspace root (the `package.json`
 * that declares `workspaces`). This makes relative paths such as `./data`
 * independent of the process working directory.
 */
export function findRepoRoot(start: string = HERE): string {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { workspaces?: unknown };
        if (parsed.workspaces) return current;
      } catch {
        // ignore unreadable package.json and keep walking up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface WebPilotConfig {
  repoRoot: string;
  port: number;
  host: string;
  corsOrigin: string;
  dataDir: string;
  downloadsDir: string;
  screenshotsDir: string;
  sessionsDir: string;
  modelsDir: string;
  dbUrl: string;
  browser: {
    engine: BrowserEngine;
    headless: boolean;
    navigationTimeoutMs: number;
    actionTimeoutMs: number;
    maxTabs: number;
    contextName: string;
  };
  limits: {
    maxAgentSteps: number;
    maxDownloads: number;
    maxFileSizeBytes: number;
    maxTaskTimeMs: number;
  };
  ai: {
    enabled: boolean;
    modelId: string;
    quantization: string;
    maxNewTokens: number;
    embeddingModelId: string;
  };
  safety: {
    downloadAllowlist: string[];
    requireDownloadConfirmation: boolean;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

type Env = Record<string, string | undefined>;

function readNumber(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readBoolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readString(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function readList(env: Env, key: string): string[] {
  return readString(env, key, '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Minimal `.env` reader so tools that do not preload dotenv (vitest, tsc)
 * behave like the Bun runtime. Real environment variables always win.
 */
function loadDotEnv(root: string, env: Env): void {
  if (env.NODE_ENV === 'test') return;
  const file = path.join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (env[key] === undefined) env[key] = value;
  }
}

export function loadConfig(env: Env = process.env): WebPilotConfig {
  const repoRoot = readString(env, 'WEBPILOT_REPO_ROOT', findRepoRoot());
  loadDotEnv(repoRoot, env);

  const resolvePath = (value: string): string =>
    path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

  const dataDir = resolvePath(readString(env, 'WEBPILOT_DATA_DIR', './data'));
  const maxFileSizeMb = readNumber(env, 'WEBPILOT_MAX_FILE_SIZE_MB', 25, 1, 2_048);

  return {
    repoRoot,
    port: readNumber(env, 'WEBPILOT_PORT', 8787, 1, 65_535),
    host: readString(env, 'WEBPILOT_HOST', '127.0.0.1'),
    corsOrigin: readString(env, 'WEBPILOT_CORS_ORIGIN', 'http://localhost:3000'),
    dataDir,
    downloadsDir: resolvePath(
      readString(env, 'WEBPILOT_DOWNLOADS_DIR', path.join(dataDir, 'downloads')),
    ),
    screenshotsDir: resolvePath(
      readString(env, 'WEBPILOT_SCREENSHOTS_DIR', path.join(dataDir, 'screenshots')),
    ),
    sessionsDir: resolvePath(
      readString(env, 'WEBPILOT_SESSIONS_DIR', path.join(dataDir, 'sessions')),
    ),
    modelsDir: resolvePath(readString(env, 'WEBPILOT_MODELS_DIR', './models')),
    dbUrl: resolvePath(readString(env, 'WEBPILOT_DB_URL', path.join(dataDir, 'webpilot.db'))),
    browser: {
      engine: readString(env, 'WEBPILOT_BROWSER', 'chromium') as BrowserEngine,
      headless: readBoolean(env, 'WEBPILOT_HEADLESS', true),
      navigationTimeoutMs: readNumber(env, 'WEBPILOT_NAV_TIMEOUT_MS', 30_000, 1_000, 180_000),
      actionTimeoutMs: readNumber(env, 'WEBPILOT_ACTION_TIMEOUT_MS', 10_000, 500, 120_000),
      maxTabs: readNumber(env, 'WEBPILOT_MAX_BROWSER_TABS', 3, 1, 20),
      contextName: readString(env, 'WEBPILOT_BROWSER_CONTEXT_NAME', 'WebPilot Browser Context'),
    },
    limits: {
      maxAgentSteps: readNumber(env, 'WEBPILOT_MAX_AGENT_STEPS', 30, 1, 500),
      maxDownloads: readNumber(env, 'WEBPILOT_MAX_DOWNLOADS', 100, 1, 1_000),
      maxFileSizeBytes: maxFileSizeMb * 1_024 * 1_024,
      maxTaskTimeMs: readNumber(env, 'WEBPILOT_MAX_TASK_TIME_MS', 600_000, 5_000, 3_600_000),
    },
    ai: {
      enabled: readBoolean(env, 'WEBPILOT_AI_ENABLED', true),
      modelId: readString(env, 'WEBPILOT_AI_MODEL_ID', 'onnx-community/Qwen2.5-0.5B-Instruct'),
      quantization: readString(env, 'WEBPILOT_AI_QUANTIZATION', 'q4'),
      maxNewTokens: readNumber(env, 'WEBPILOT_AI_MAX_NEW_TOKENS', 512, 32, 4_096),
      embeddingModelId: readString(env, 'WEBPILOT_EMBEDDING_MODEL_ID', 'Xenova/all-MiniLM-L6-v2'),
    },
    safety: {
      downloadAllowlist: readList(env, 'WEBPILOT_DOWNLOAD_ALLOWLIST'),
      requireDownloadConfirmation: readBoolean(
        env,
        'WEBPILOT_REQUIRE_DOWNLOAD_CONFIRMATION',
        false,
      ),
    },
    logLevel: readString(env, 'WEBPILOT_LOG_LEVEL', 'info') as WebPilotConfig['logLevel'],
  };
}

/** Process wide configuration, resolved once from the environment. */
export const config: WebPilotConfig = loadConfig();

export function getConfig(): WebPilotConfig {
  return config;
}