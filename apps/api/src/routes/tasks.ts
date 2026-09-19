/**
 * Task endpoints.
 *
 * `POST /tasks` is the one call the dashboard needs to make the vision real:
 * a natural-language prompt goes in, a queued task comes back, and the run
 * streams over `GET /tasks/:id/events` or the WebSocket.
 */
import { Elysia } from 'elysia';
import {
  CreateTaskRequestSchema,
  DecidePermissionRequestSchema,
  WebPilotError,
  type CreateTaskRequest,
} from '@webpilot/schemas';
import type { AgentService } from '../agent/service';

function badRequest(message: string): { error: { code: string; message: string } } {
  return { error: { code: 'ACTION_INVALID', message } };
}

export function taskRoutes(service: AgentService) {
  return new Elysia({ name: 'webpilot-tasks', prefix: '/tasks' })
    /** Creates a task and starts it unless `autoRun: false`. */
    .post('/', ({ body, set }) => {
      const parsed = CreateTaskRequestSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return badRequest(
          parsed.error.issues.map((issue) => issue.message).join('; ') || 'invalid task',
        );
      }

      try {
        const task = service.createTask(parsed.data as CreateTaskRequest);
        set.status = 202;
        return { task };
      } catch (error) {
        set.status = 500;
        return badRequest((error as Error).message);
      }
    })

    /** Recent tasks, newest first. */
    .get('/', ({ query }) => {
      const limit = Number(query['limit'] ?? 50);
      return {
        tasks: service.listTasks(Number.isFinite(limit) ? limit : 50),
        queueLength: service.queueLength,
        activeTaskId: service.activeTaskId,
      };
    })

    .get('/:id', ({ params, set }) => {
      const task = service.getTask(params.id);
      if (!task) {
        set.status = 404;
        return badRequest(`Unknown task: ${params.id}`);
      }
      return { task };
    })

    /** Replayable timeline. `?since=<sequence>` returns only newer events. */
    .get('/:id/events', ({ params, query, set }) => {
      if (!service.getTask(params.id)) {
        set.status = 404;
        return badRequest(`Unknown task: ${params.id}`);
      }
      const since = Number(query['since'] ?? -1);
      return {
        events: service.listEvents(params.id, Number.isFinite(since) ? since : -1),
      };
    })

    .post('/:id/cancel', ({ params, set }) => {
      const task = service.getTask(params.id);
      if (!task) {
        set.status = 404;
        return badRequest(`Unknown task: ${params.id}`);
      }
      const cancelled = service.cancelTask(params.id);
      set.status = cancelled ? 202 : 409;
      return { cancelled, task: service.getTask(params.id) };
    })

    /** Pending human-permission requests for a task. */
    .get('/:id/permissions', ({ params, set }) => {
      if (!service.getTask(params.id)) {
        set.status = 404;
        return badRequest(`Unknown task: ${params.id}`);
      }
      return { permissions: service.pendingPermissions(params.id) };
    })

    /** Grants or denies one permission request. */
    .post('/:id/permissions/:permissionId', ({ params, body, set }) => {
      const parsed = DecidePermissionRequestSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return badRequest('body must be { grant: boolean, remember?: boolean }');
      }

      const decision = {
        granted: parsed.data.grant,
        ...(parsed.data.remember !== undefined ? { remember: parsed.data.remember } : {}),
      };

      const accepted = service.decidePermission(params.id, params.permissionId, decision);
      if (!accepted) {
        set.status = 404;
        return badRequest('No pending permission request with that id for this task');
      }
      return { accepted: true, permissionId: params.permissionId };
    });
}

/** Re-exported so route tests can assert the exact error envelope. */
export { WebPilotError };