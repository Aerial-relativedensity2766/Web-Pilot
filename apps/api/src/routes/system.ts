/**
 * Read-only system endpoints: model status, effective settings and browser state.
 *
 * Deliberately **no filesystem paths, no environment values, no secrets** — the
 * dashboard only needs to explain *what* the agent can do, not *where* it lives.
 */
import { Elysia } from 'elysia';
import { config } from '@webpilot/shared';
import type { AgentService } from '../agent/service';

export function systemRoutes(service: AgentService) {
  return new Elysia({ name: 'webpilot-system' })
    /** Local model status (never the model directory). */
    .get('/models', () => {
      const status = service.modelStatus();
      return {
        model: {
          modelId: status.modelId,
          quantization: status.quantization,
          embeddingModelId: status.embeddingModelId,
          execution: status.execution,
          networkInference: status.networkInference,
          status: status.status,
          embeddingStatus: status.embeddingStatus,
          unavailable: status.unavailable,
          embeddingUnavailable: status.embeddingUnavailable,
        },
      };
    })

    /** Effective limits and safety settings. */
    .get('/settings', () => ({ settings: service.settings() }))

    /** Browser engine and current lifecycle status. */
    .get('/browser', () => ({
      browser: {
        status: service.browserStatus(),
        engine: config.browser.engine,
        headless: config.browser.headless,
        maxTabs: config.browser.maxTabs,
      },
    }))

    /** What the agent is doing right now (single-run queue). */
    .get('/activity', () => ({
      activeTaskId: service.activeTaskId,
      queueLength: service.queueLength,
      pendingPermissions: service.pendingPermissions().length,
      eventsSubscribers: service.broadcaster.count(),
    }));
}