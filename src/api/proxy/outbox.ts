import type { OutboxDoneDto } from '../../proxygram/server/types';
import { PxgError } from '../../proxygram/server/types';

import { pause } from '../../util/schedulers';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';

const POLL_INTERVAL_MS = 3000;

/**
 * Events provide fast completion; polling recovers replies missed during a reconnect. With `timeoutMs` the caller
 * stops waiting and the polling stops with it: a job the worker never takes would otherwise be polled forever
 */
export async function runProxyJob(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
  const userId = getPxgState().session?.user.id;
  let jobId: string | undefined;
  let isFinished = false;
  let resolveEvent: (event: OutboxDoneDto) => void;
  const completion = new Promise<OutboxDoneDto>((resolve) => {
    resolveEvent = resolve;
  });
  const unsubscribe = pxgRpc.on((event) => {
    // A delayed job is retried by the server; only its final result settles the call
    if (event.e === 'outbox.done' && event.d.id === jobId && event.d.status !== 'delayed') resolveEvent(event.d);
  });
  try {
    const queued = await pxgRpc.call<{ id?: string; status?: string }>(method, params);
    if (!queued.id) return { complete: queued.status === 'complete' };
    jobId = queued.id;
    const result = await Promise.race([
      completion, pollJob(queued.id), ...(timeoutMs ? [rejectAfter(timeoutMs)] : []),
    ]);
    if (result.status === 'failed') {
      // a machine reason comes back as the error code; Telegram's own codes stay as they are
      const reason = result.error && /^[a-z][a-z0-9_]*$/.test(result.error) ? result.error : undefined;
      throw new PxgError('outbox_failed', result.error || undefined, reason);
    }
    return result.result;
  } finally {
    isFinished = true;
    unsubscribe();
  }

  async function pollJob(id: string): Promise<OutboxDoneDto> {
    while (!isFinished) {
      if (getPxgState().session?.user.id !== userId) throw new PxgError('unauthorized');
      try {
        const job = await pxgRpc.call<OutboxDoneDto>('outbox.get', { id });
        if (job.status === 'done' || job.status === 'failed') return job;
      } catch (err) {
        if (err instanceof PxgError && (err.code === 'not_found' || err.code === 'unauthorized')) throw err;
      }
      await pause(POLL_INTERVAL_MS);
    }
    // The event has already resolved the outer race
    return completion;
  }
}

async function rejectAfter(ms: number): Promise<never> {
  await pause(ms);
  throw new PxgError('timeout');
}
