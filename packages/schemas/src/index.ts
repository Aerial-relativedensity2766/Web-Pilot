/**
 * @webpilot/schemas
 *
 * Shared Zod schemas and TypeScript types describing everything that crosses a
 * boundary in WebPilot: AI produced actions, task records, agent events,
 * download manifests, permissions and structured errors.
 *
 * Nothing in this package performs I/O — it is the contract every other
 * package (and the browser, the database and the UI) agrees on.
 */
export * from './actions';
export * from './downloads';
export * from './errors';
export * from './events';
export * from './limits';
export * from './page';
export * from './state';
export * from './task';