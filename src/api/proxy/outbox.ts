import type { OutboxDoneDto } from '../../proxygram/server/types';
import { PxgError } from '../../proxygram/server/types';

import { pause } from '../../util/schedulers';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';

const POLL_INTERVAL_MS = 3000;

/** Events provide fast completion; polling recovers replies missed during a reconnect */
export async function runProxyJob(method: string, params: unknown): Promise<unknown> {
  const userId = getPxgState().session?.user.id;
  let jobId: string | undefined;
  let isFinished = false;
  let resolveEvent: (event: OutboxDoneDto) => void;
  const completion = new Promise<OutboxDoneDto>((resolve) => {
    resolveEvent = resolve;
  });
  const unsubscribe = pxgRpc.on((event) => {
    if (event.e === 'outbox.done' && event.d.id === jobId) resolveEvent(event.d);
  });
  try {
    const queued = await pxgRpc.call<{ id?: string; status?: string }>(method, params);
    if (!queued.id) return { complete: queued.status === 'complete' };
    jobId = queued.id;
    const result = await Promise.race([completion, pollJob(queued.id)]);
    if (result.status === 'failed') throw new PxgError('outbox_failed', result.error || undefined);
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
