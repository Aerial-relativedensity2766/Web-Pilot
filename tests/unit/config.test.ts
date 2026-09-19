import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config, findRepoRoot, getConfig, loadConfig, type WebPilotConfig } from '@webpilot/shared';

/** Absolute fixture root so path defaults are deterministic and independent of cwd. */
const FIXTURE_ROOT = '/tmp/webpilot-config-fixture';
const MIB = 1_024 * 1_024;

type Env = Record<string, string | undefined>;

function loadFromEnv(env: Env = {}): WebPilotConfig {
  return loadConfig({
    NODE_ENV: 'test',
    WEBPILOT_REPO_ROOT: FIXTURE_ROOT,
    ...env,
  });
}

describe('getConfig', () => {
  it('returns the process-wide config singleton', () => {
    expect(getConfig()).toBe(config);
    expect(Number.isFinite(getConfig().port)).toBe(true);
  });
});

describe('loadConfig isolation', () => {
  it('does not mutate process.env when given an explicit env object', () => {
    const portBefore = process.env.WEBPILOT_PORT;
    const stepsBefore = process.env.WEBPILOT_MAX_AGENT_STEPS;

    const cfg = loadConfig({
      NODE_ENV: 'test',
      WEBPILOT_REPO_ROOT: FIXTURE_ROOT,
      WEBPILOT_PORT: '9999',
      WEBPILOT_MAX_AGENT_STEPS: '12',
    });

    expect(cfg.port).toBe(9999);
    expect(cfg.limits.maxAgentSteps).toBe(12);
    expect(process.env.WEBPILOT_PORT).toBe(portBefore);
    expect(process.env.WEBPILOT_MAX_AGENT_STEPS).toBe(stepsBefore);
  });

  it('uses WEBPILOT_REPO_ROOT when provided and findRepoRoot when it is absent', () => {
    expect(loadFromEnv().repoRoot).toBe(FIXTURE_ROOT);
    expect(loadConfig({ NODE_ENV: 'test' }).repoRoot).toBe(findRepoRoot());
  });
});

describe('loadConfig documented defaults', () => {
  const dataDir = path.resolve(FIXTURE_ROOT, './data');

  it.each([
    { field: 'port', expected: 8787, read: (c: WebPilotConfig) => c.port },
    { field: 'host', expected: '127.0.0.1', read: (c: WebPilotConfig) => c.host },
    {
      field: 'corsOrigin',
      expected: 'http://localhost:3000',
      read: (c: WebPilotConfig) => c.corsOrigin,
    },
    { field: 'dataDir', expected: dataDir, read: (c: WebPilotConfig) => c.dataDir },
    {
      field: 'downloadsDir',
      expected: path.join(dataDir, 'downloads'),
      read: (c: WebPilotConfig) => c.downloadsDir,
    },
    {
      field: 'screenshotsDir',
      expected: path.join(dataDir, 'screenshots'),
      read: (c: WebPilotConfig) => c.screenshotsDir,
    },
    {
      field: 'sessionsDir',
      expected: path.join(dataDir, 'sessions'),
      read: (c: WebPilotConfig) => c.sessionsDir,
    },
    {
      field: 'modelsDir',
      expected: path.resolve(FIXTURE_ROOT, './models'),
      read: (c: WebPilotConfig) => c.modelsDir,
    },
    {
      field: 'dbUrl',
      expected: path.join(dataDir, 'webpilot.db'),
      read: (c: WebPilotConfig) => c.dbUrl,
    },
    { field: 'browser.engine', expected: 'chromium', read: (c: WebPilotConfig) => c.browser.engine },
    { field: 'browser.headless', expected: true, read: (c: WebPilotConfig) => c.browser.headless },
    {
      field: 'browser.navigationTimeoutMs',
      expected: 30_000,
      read: (c: WebPilotConfig) => c.browser.navigationTimeoutMs,
    },
    {
      field: 'browser.actionTimeoutMs',
      expected: 10_000,
      read: (c: WebPilotConfig) => c.browser.actionTimeoutMs,
    },
    { field: 'browser.maxTabs', expected: 3, read: (c: WebPilotConfig) => c.browser.maxTabs },
    {
      field: 'browser.contextName',
      expected: 'WebPilot Browser Context',
      read: (c: WebPilotConfig) => c.browser.contextName,
    },
    {
      field: 'limits.maxAgentSteps',
      expected: 30,
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
    },
    {
      field: 'limits.maxDownloads',
      expected: 100,
      read: (c: WebPilotConfig) => c.limits.maxDownloads,
    },
    {
      field: 'limits.maxFileSizeBytes',
      expected: 25 * MIB,
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
    },
    {
      field: 'limits.maxTaskTimeMs',
      expected: 600_000,
      read: (c: WebPilotConfig) => c.limits.maxTaskTimeMs,
    },
    { field: 'ai.enabled', expected: true, read: (c: WebPilotConfig) => c.ai.enabled },
    {
      field: 'ai.modelId',
      expected: 'onnx-community/Qwen2.5-0.5B-Instruct',
      read: (c: WebPilotConfig) => c.ai.modelId,
    },
    { field: 'ai.quantization', expected: 'q4', read: (c: WebPilotConfig) => c.ai.quantization },
    { field: 'ai.maxNewTokens', expected: 512, read: (c: WebPilotConfig) => c.ai.maxNewTokens },
    {
      field: 'ai.embeddingModelId',
      expected: 'Xenova/all-MiniLM-L6-v2',
      read: (c: WebPilotConfig) => c.ai.embeddingModelId,
    },
    {
      field: 'safety.downloadAllowlist',
      expected: [] as string[],
      read: (c: WebPilotConfig) => c.safety.downloadAllowlist,
    },
    {
      field: 'safety.requireDownloadConfirmation',
      expected: false,
      read: (c: WebPilotConfig) => c.safety.requireDownloadConfirmation,
    },
    { field: 'logLevel', expected: 'info', read: (c: WebPilotConfig) => c.logLevel },
  ])('$field matches the documented default ($expected)', ({ expected, read }) => {
    expect(read(loadFromEnv())).toEqual(expected);
  });

  it.each([
    { envKey: 'WEBPILOT_PORT', blank: '', read: (c: WebPilotConfig) => c.port, expected: 8787 },
    { envKey: 'WEBPILOT_PORT', blank: '   ', read: (c: WebPilotConfig) => c.port, expected: 8787 },
    {
      envKey: 'WEBPILOT_MAX_AGENT_STEPS',
      blank: '\t',
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 30,
    },
    {
      envKey: 'WEBPILOT_MAX_FILE_SIZE_MB',
      blank: '  ',
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 25 * MIB,
    },
    {
      envKey: 'WEBPILOT_HOST',
      blank: '',
      read: (c: WebPilotConfig) => c.host,
      expected: '127.0.0.1',
    },
    {
      envKey: 'WEBPILOT_REPO_ROOT',
      blank: '   ',
      read: (c: WebPilotConfig) => c.repoRoot,
      expected: findRepoRoot(),
    },
  ])('treats blank $envKey as absent (fallback $expected)', ({ envKey, blank, read, expected }) => {
    const env: Env = { [envKey]: blank };
    if (envKey !== 'WEBPILOT_REPO_ROOT') {
      env.WEBPILOT_REPO_ROOT = FIXTURE_ROOT;
    }
    expect(
      read(
        loadConfig({
          NODE_ENV: 'test',
          ...env,
        }),
      ),
    ).toBe(expected);
  });
});

describe('loadConfig numeric resource limits', () => {
  it.each([
    {
      name: 'port accepts a value inside 1–65535',
      env: { WEBPILOT_PORT: '3000' },
      read: (c: WebPilotConfig) => c.port,
      expected: 3000,
    },
    {
      name: 'maxAgentSteps accepts a value inside 1–500',
      env: { WEBPILOT_MAX_AGENT_STEPS: '40' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 40,
    },
    {
      name: 'maxDownloads accepts a value inside 1–1000',
      env: { WEBPILOT_MAX_DOWNLOADS: '250' },
      read: (c: WebPilotConfig) => c.limits.maxDownloads,
      expected: 250,
    },
    {
      name: 'maxFileSizeMb converts a valid override to bytes',
      env: { WEBPILOT_MAX_FILE_SIZE_MB: '10' },
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 10 * MIB,
    },
    {
      name: 'maxTaskTimeMs accepts a value inside 5000–3600000',
      env: { WEBPILOT_MAX_TASK_TIME_MS: '120000' },
      read: (c: WebPilotConfig) => c.limits.maxTaskTimeMs,
      expected: 120_000,
    },
    {
      name: 'maxBrowserTabs accepts a value inside 1–20',
      env: { WEBPILOT_MAX_BROWSER_TABS: '8' },
      read: (c: WebPilotConfig) => c.browser.maxTabs,
      expected: 8,
    },
    {
      name: 'navigationTimeoutMs accepts a value inside 1000–180000',
      env: { WEBPILOT_NAV_TIMEOUT_MS: '45000' },
      read: (c: WebPilotConfig) => c.browser.navigationTimeoutMs,
      expected: 45_000,
    },
    {
      name: 'actionTimeoutMs accepts a value inside 500–120000',
      env: { WEBPILOT_ACTION_TIMEOUT_MS: '2500' },
      read: (c: WebPilotConfig) => c.browser.actionTimeoutMs,
      expected: 2_500,
    },
    {
      name: 'maxNewTokens accepts a value inside 32–4096',
      env: { WEBPILOT_AI_MAX_NEW_TOKENS: '256' },
      read: (c: WebPilotConfig) => c.ai.maxNewTokens,
      expected: 256,
    },
    {
      name: 'whitespace-padded digits are parsed',
      env: { WEBPILOT_MAX_AGENT_STEPS: '  42  ' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 42,
    },
  ])('$name', ({ env, read, expected }) => {
    expect(read(loadFromEnv(env))).toBe(expected);
  });

  it.each([
    {
      name: 'non-numeric port falls back to 8787',
      env: { WEBPILOT_PORT: 'not-a-number' },
      read: (c: WebPilotConfig) => c.port,
      expected: 8787,
    },
    {
      name: 'NaN maxAgentSteps falls back to 30',
      env: { WEBPILOT_MAX_AGENT_STEPS: 'NaN' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 30,
    },
    {
      name: 'Infinity maxDownloads falls back to 100',
      env: { WEBPILOT_MAX_DOWNLOADS: 'Infinity' },
      read: (c: WebPilotConfig) => c.limits.maxDownloads,
      expected: 100,
    },
    {
      name: '-Infinity maxFileSizeMb falls back to 25 MiB',
      env: { WEBPILOT_MAX_FILE_SIZE_MB: '-Infinity' },
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 25 * MIB,
    },
    {
      name: 'trailing junk on maxTaskTimeMs falls back to 600000',
      env: { WEBPILOT_MAX_TASK_TIME_MS: '600000ms' },
      read: (c: WebPilotConfig) => c.limits.maxTaskTimeMs,
      expected: 600_000,
    },
    {
      name: 'empty-looking numeric junk on maxTabs falls back to 3',
      env: { WEBPILOT_MAX_BROWSER_TABS: 'abc' },
      read: (c: WebPilotConfig) => c.browser.maxTabs,
      expected: 3,
    },
  ])('$name', ({ env, read, expected }) => {
    expect(read(loadFromEnv(env))).toBe(expected);
  });

  it.each([
    {
      name: 'truncates port 3000.9 to 3000',
      env: { WEBPILOT_PORT: '3000.9' },
      read: (c: WebPilotConfig) => c.port,
      expected: 3000,
    },
    {
      name: 'truncates maxAgentSteps 40.2 to 40',
      env: { WEBPILOT_MAX_AGENT_STEPS: '40.2' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 40,
    },
    {
      name: 'truncates maxFileSizeMb 10.8 before converting to bytes',
      env: { WEBPILOT_MAX_FILE_SIZE_MB: '10.8' },
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 10 * MIB,
    },
    {
      name: 'truncates maxNewTokens 256.99 to 256',
      env: { WEBPILOT_AI_MAX_NEW_TOKENS: '256.99' },
      read: (c: WebPilotConfig) => c.ai.maxNewTokens,
      expected: 256,
    },
  ])('$name', ({ env, read, expected }) => {
    expect(read(loadFromEnv(env))).toBe(expected);
  });

  it.each([
    {
      name: 'clamps port below 1 up to 1',
      env: { WEBPILOT_PORT: '0' },
      read: (c: WebPilotConfig) => c.port,
      expected: 1,
    },
    {
      name: 'clamps port above 65535 down to 65535',
      env: { WEBPILOT_PORT: '70000' },
      read: (c: WebPilotConfig) => c.port,
      expected: 65_535,
    },
    {
      name: 'clamps maxAgentSteps below 1 up to 1',
      env: { WEBPILOT_MAX_AGENT_STEPS: '-4' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 1,
    },
    {
      name: 'clamps maxAgentSteps above 500 down to 500',
      env: { WEBPILOT_MAX_AGENT_STEPS: '9999' },
      read: (c: WebPilotConfig) => c.limits.maxAgentSteps,
      expected: 500,
    },
    {
      name: 'clamps maxDownloads below 1 up to 1',
      env: { WEBPILOT_MAX_DOWNLOADS: '0' },
      read: (c: WebPilotConfig) => c.limits.maxDownloads,
      expected: 1,
    },
    {
      name: 'clamps maxDownloads above 1000 down to 1000',
      env: { WEBPILOT_MAX_DOWNLOADS: '5000' },
      read: (c: WebPilotConfig) => c.limits.maxDownloads,
      expected: 1_000,
    },
    {
      name: 'clamps maxFileSizeMb below 1 up to 1 MiB',
      env: { WEBPILOT_MAX_FILE_SIZE_MB: '0' },
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 1 * MIB,
    },
    {
      name: 'clamps maxFileSizeMb above 2048 down to 2048 MiB',
      env: { WEBPILOT_MAX_FILE_SIZE_MB: '4096' },
      read: (c: WebPilotConfig) => c.limits.maxFileSizeBytes,
      expected: 2048 * MIB,
    },
    {
      name: 'clamps maxTaskTimeMs below 5000 up to 5000',
      env: { WEBPILOT_MAX_TASK_TIME_MS: '100' },
      read: (c: WebPilotConfig) => c.limits.maxTaskTimeMs,
      expected: 5_000,
    },
    {
      name: 'clamps maxTaskTimeMs above 3600000 down to 3600000',
      env: { WEBPILOT_MAX_TASK_TIME_MS: '9999999' },
      read: (c: WebPilotConfig) => c.limits.maxTaskTimeMs,
      expected: 3_600_000,
    },
    {
      name: 'clamps maxBrowserTabs below 1 up to 1',
      env: { WEBPILOT_MAX_BROWSER_TABS: '-1.9' },
      read: (c: WebPilotConfig) => c.browser.maxTabs,
      expected: 1,
    },
    {
      name: 'clamps maxBrowserTabs above 20 down to 20',
      env: { WEBPILOT_MAX_BROWSER_TABS: '50' },
      read: (c: WebPilotConfig) => c.browser.maxTabs,
      expected: 20,
    },
    {
      name: 'clamps navigationTimeoutMs below 1000 up to 1000',
      env: { WEBPILOT_NAV_TIMEOUT_MS: '10' },
      read: (c: WebPilotConfig) => c.browser.navigationTimeoutMs,
      expected: 1_000,
    },
    {
      name: 'clamps navigationTimeoutMs above 180000 down to 180000',
      env: { WEBPILOT_NAV_TIMEOUT_MS: '200000' },
      read: (c: WebPilotConfig) => c.browser.navigationTimeoutMs,
      expected: 180_000,
    },
    {
      name: 'clamps maxNewTokens below 32 up to 32',
      env: { WEBPILOT_AI_MAX_NEW_TOKENS: '8' },
      read: (c: WebPilotConfig) => c.ai.maxNewTokens,
      expected: 32,
    },
    {
      name: 'clamps maxNewTokens above 4096 down to 4096',
      env: { WEBPILOT_AI_MAX_NEW_TOKENS: '8000' },
      read: (c: WebPilotConfig) => c.ai.maxNewTokens,
      expected: 4_096,
    },
  ])('$name', ({ env, read, expected }) => {
    expect(read(loadFromEnv(env))).toBe(expected);
  });
});
