/**
 * @webpilot/browser-core
 *
 * Playwright lifecycle (`BrowserManager`) plus the deterministic interaction
 * layer (`BrowserController`) and the resilient locator strategy. No AI logic
 * lives here: actions arrive validated and either succeed or raise a typed
 * `WebPilotError`.
 */
export * from './browser-controller';
export * from './browser-manager';
export * from './locator';