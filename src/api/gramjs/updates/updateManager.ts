import { Api as GramJs, type Update } from '../../../lib/gramjs';
import { RPCError } from '../../../lib/gramjs/errors';
import {
  UpdateConnectionState, UpdateServerTimeOffset, UpdateSessionGap,
} from '../../../lib/gramjs/network';
import type { Entity } from '../../../lib/gramjs/types';

import type { ApiChat } from '../../types';
import type { invokeRequest } from '../methods/client';

import { DEBUG } from '../../../config';
import SortedQueue from '../../../util/SortedQueue';
import { buildApiPeerId } from '../apiBuilders/peers';
import { buildInputChannel, buildMtpPeerId } from '../gramjsBuilders';
import localDb from '../localDb';
import { sendApiUpdate } from './apiUpdateEmitter';
import { processAndUpdateEntities } from './entityProcessor';
import { updater } from './mtpUpdateHandler';

import { buildLocalUpdatePts, type UpdatePts } from './UpdatePts';

export type State = {
  seq: number;
  date: number;
  pts: number;
  qts: number;
};
type SeqUpdate = (GramJs.Updates | GramJs.UpdatesCombined) & { _isFromDifference?: true };
type PtsUpdate = ((GramJs.TypeUpdate & { pts: number }) | UpdatePts) & { _isFromDifference?: true };
type ChannelDifferenceReason = 'gapRecovery' | 'shortpoll';
type ChannelScheduler = {
  timeout?: number;
  deadline?: number;
  reason?: ChannelDifferenceReason;
  isInFlight: boolean;
  shortpollTimeoutMs?: number;
  isShortpollEligible?: boolean;
};

const COMMON_BOX_QUEUE_ID = '0';

const SHORTPOLL_CHANNEL_DIFFERENCE_LIMIT = 100;
const CATCH_UP_CHANNEL_DIFFERENCE_LIMIT = 1000;

const SHORTPOLL_DEFAULT_TIMEOUT_MS = 1000;
const INITIAL_SHORTPOLL_TIMEOUT_MS = 10000;
const CHANNEL_DIFFERENCE_RETRY_TIMEOUT_MS = 5000;
const UPDATE_WAIT_TIMEOUT = 500;
// PXG: A difference request that never answers (connection lost mid-request, relay restarted) must not block the
// updates forever: it is abandoned and asked again, each time with more patience
const DIFFERENCE_TIMEOUTS_MS = [30000, 60000, 120000];
const DIFFERENCE_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];
const REMOTE_STATE_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];

const TERMINAL_CHANNEL_DIFFERENCE_ERRORS = new Set([
  'CHANNEL_INVALID',
  'CHANNEL_PRIVATE',
]);

let invoke: typeof invokeRequest;
// PXG: The manager can retry on its own only after `init` gave it the way to call Telegram
let hasInvoke = false;
let isInited = false;

let seqTimeout: number | undefined;
// PXG: One difference at a time; a request made while it runs is served right after it
let isDifferenceInFlight = false;
let isDifferenceRequestedAgain = false;
let differenceGeneration = 0;
let differenceFailures = 0;
let differenceRetryTimeout: number | undefined;
let isLoadingRemoteState = false;
let remoteStateFailures = 0;
let remoteStateRetryTimeout: number | undefined;
const CHANNEL_SCHEDULERS = new Map<string, ChannelScheduler>();
const OPENED_CHANNEL_IDS = new Set<string>();

const SEQ_QUEUE = new SortedQueue<SeqUpdate>(seqComparator);
const PTS_QUEUE = new Map<string, SortedQueue<PtsUpdate>>();

export async function init(invokeReq: typeof invokeRequest) {
  invoke = invokeReq;
  hasInvoke = true;

  // PXG: The API was recreated within this page (reconnect after a stuck resync, a broken connection): the known state
  // catches up with everything missed meanwhile. A fresh state from `GetState` would skip it for good
  const { pts, date } = localDb.commonBoxState;
  if (pts !== undefined && date) {
    isInited = true;
    scheduleGetDifference(0);
    return;
  }

  // PXG: Without the remote state nothing is applied; `loadRemoteState` keeps retrying until it gets it
  if (!await loadRemoteState()) return;

  scheduleGetDifference();
}

export function applyState(state: State) {
  localDb.commonBoxState.seq = state.seq;
  localDb.commonBoxState.date = state.date;
  localDb.commonBoxState.pts = state.pts;
  localDb.commonBoxState.qts = state.qts;
}

export function processUpdate(update: Update, isFromDifference?: boolean, shouldOnlySave?: boolean) {
  if (update instanceof UpdateConnectionState) {
    if (update.state === UpdateConnectionState.connected) {
      if (isInited) {
        scheduleGetDifference();
      } else if (hasInvoke) {
        // PXG: The state could not be loaded while offline: the connection is back, try at once
        void loadRemoteState();
      }
    }

    updater(update);
    return;
  }

  if (update instanceof UpdateServerTimeOffset) {
    updater(update);
    return;
  }

  if (update instanceof UpdateSessionGap) {
    if (isInited) scheduleGetDifference();
    else if (hasInvoke) void loadRemoteState();
    return;
  }

  if (localDb.commonBoxState.seq === undefined) {
    // Drop updates received before first sync
    return;
  }

  if (update instanceof GramJs.Updates || update instanceof GramJs.UpdatesCombined) {
    if (isFromDifference) {
      (update as SeqUpdate)._isFromDifference = true;
    }

    saveSeqUpdate(update, shouldOnlySave);
    return;
  }

  if ('pts' in update) {
    if (update instanceof GramJs.UpdateChannelTooLong) {
      scheduleChannelDifference(getUpdateChannelId(update), 'gapRecovery', 0);
      return;
    }
    if (isFromDifference) {
      (update as PtsUpdate)._isFromDifference = true;
    }
    savePtsUpdate(update, shouldOnlySave);
    return;
  }

  updater(update);
}

export function updateChannelState(channelId: string, pts: number) {
  const channel = localDb.chats[channelId];
  if (!(channel instanceof GramJs.Channel)) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[UpdateManager] Channel ${channelId} not found in localDb`);
    }
    return;
  }

  const currentState = localDb.channelPtsById[channelId];

  if (currentState && currentState < pts) {
    scheduleGetChannelDifference(channelId);
    return;
  }

  localDb.channelPtsById[channelId] = pts;
}

function applyUpdate(updateObject: SeqUpdate | PtsUpdate) {
  if ('seq' in updateObject && updateObject.seq) {
    localDb.commonBoxState.seq = updateObject.seq;
    localDb.commonBoxState.date = updateObject.date;
  }

  if ('qts' in updateObject) {
    localDb.commonBoxState.qts = updateObject.qts;
  }

  if ('pts' in updateObject) {
    const channelId = getUpdateChannelId(updateObject);
    if (channelId !== COMMON_BOX_QUEUE_ID) {
      localDb.channelPtsById[channelId] = updateObject.pts;
    } else {
      localDb.commonBoxState.pts = updateObject.pts;
    }
  }

  if (updateObject instanceof GramJs.UpdatesCombined || updateObject instanceof GramJs.Updates) {
    processAndUpdateEntities(updateObject);
    const entities = (updateObject.users as Entity[]).concat(updateObject.chats);

    updateObject.updates.forEach((update) => {
      if (entities) {
        (update as any)._entities = entities;
      }

      processUpdate(update);
    });
  } else {
    updater(updateObject);
  }
}

function saveSeqUpdate(update: GramJs.Updates | GramJs.UpdatesCombined, shouldOnlySave?: boolean) {
  SEQ_QUEUE.add(update);

  if (!shouldOnlySave) popSeqQueue();
}

function savePtsUpdate(update: PtsUpdate, shouldOnlySave?: boolean) {
  const channelId = getUpdateChannelId(update);

  const ptsQueue = PTS_QUEUE.get(channelId) || new SortedQueue<PtsUpdate>(ptsComparator);
  ptsQueue.add(update);

  PTS_QUEUE.set(channelId, ptsQueue);

  if (!shouldOnlySave) popPtsQueue(channelId);
}

function popSeqQueue() {
  if (!SEQ_QUEUE.size) return;

  const update = SEQ_QUEUE.pop()!;
  const localSeq = localDb.commonBoxState.seq;
  const seqStart = 'seqStart' in update ? update.seqStart : update.seq;

  if (seqStart === 0 || (update._isFromDifference && seqStart >= localSeq + 1)) {
    applyUpdate(update);
  } else if (seqStart === localSeq + 1) {
    clearTimeout(seqTimeout);
    seqTimeout = undefined;

    applyUpdate(update);
  } else if (seqStart > localSeq + 1) {
    SEQ_QUEUE.add(update); // Return update to queue
    scheduleGetDifference();
    return; // Prevent endless loop
  }

  popSeqQueue();
}

function popPtsQueue(channelId: string) {
  const ptsQueue = PTS_QUEUE.get(channelId);
  if (!ptsQueue?.size) return;

  const update = ptsQueue.pop()!;
  const localPts = channelId === COMMON_BOX_QUEUE_ID ? localDb.commonBoxState.pts : localDb.channelPtsById[channelId];
  const pts = update.pts;
  const ptsCount = getPtsCount(update);

  // Sometimes server sends updates for channels that are opened in other clients. We ignore them
  if (localPts === undefined) {
    if (DEBUG) {
      // Uncomment to debug missing updates

      // console.error('[UpdateManager] Got pts update without local state', channelId);
    }
    return;
  }

  if (update._isFromDifference && pts >= localPts + ptsCount) {
    applyUpdate(update);
  } else if (pts === localPts + ptsCount) {
    clearScheduledChannelDifference(channelId, 'gapRecovery');
    scheduleShortpollFromNow(channelId);

    applyUpdate(update);
  } else if (pts > localPts + ptsCount) {
    ptsQueue.add(update); // Return update to queue
    if (channelId === COMMON_BOX_QUEUE_ID) {
      scheduleGetDifference();
    } else {
      scheduleGetChannelDifference(channelId);
    }
    return; // Prevent endless loop
  }

  popPtsQueue(channelId);
}

export function scheduleGetChannelDifference(channelId: string) {
  scheduleChannelDifference(channelId, 'gapRecovery', UPDATE_WAIT_TIMEOUT);
}

export function requestChannelDifference(channelId: string) {
  scheduleChannelDifference(channelId, 'gapRecovery', 0);
}

export function setOpenedChannelIds(channelIds: string[]) {
  const nextOpenedChannelIds = new Set(channelIds);

  OPENED_CHANNEL_IDS.forEach((channelId) => {
    if (nextOpenedChannelIds.has(channelId)) {
      return;
    }

    getOrCreateChannelScheduler(channelId).isShortpollEligible = false;
    clearScheduledChannelDifference(channelId, 'shortpoll');
  });

  channelIds.forEach((channelId) => {
    const scheduler = getOrCreateChannelScheduler(channelId);
    const wasOpened = OPENED_CHANNEL_IDS.has(channelId);

    scheduler.isShortpollEligible = true;

    if (!wasOpened) {
      if (scheduler.shortpollTimeoutMs !== undefined) {
        restartShortpollFromNow(channelId);
      } else {
        scheduleChannelDifference(channelId, 'shortpoll', INITIAL_SHORTPOLL_TIMEOUT_MS);
      }
    }
  });

  OPENED_CHANNEL_IDS.clear();
  channelIds.forEach((channelId) => {
    OPENED_CHANNEL_IDS.add(channelId);
  });
}

function getOrCreateChannelScheduler(channelId: string) {
  const current = CHANNEL_SCHEDULERS.get(channelId);
  if (current) {
    return current;
  }

  const scheduler: ChannelScheduler = {
    isInFlight: false,
  };
  CHANNEL_SCHEDULERS.set(channelId, scheduler);
  return scheduler;
}

function scheduleChannelDifference(channelId: string, reason: ChannelDifferenceReason, timeoutMs: number) {
  const scheduler = getOrCreateChannelScheduler(channelId);
  const deadline = Date.now() + timeoutMs;
  if (scheduler.deadline !== undefined && scheduler.deadline <= deadline) {
    return;
  }

  clearScheduledChannelDifference(channelId);

  scheduler.reason = reason;
  scheduler.deadline = deadline;
  scheduler.timeout = setTimeout(() => {
    scheduler.timeout = undefined;
    scheduler.deadline = undefined;
    if (scheduler.isInFlight) {
      scheduleChannelDifference(channelId, reason, UPDATE_WAIT_TIMEOUT);
      return;
    }

    void runChannelDifference(channelId, reason);
  }, timeoutMs);
}

function clearScheduledChannelDifference(channelId: string, reason?: ChannelDifferenceReason) {
  const scheduler = CHANNEL_SCHEDULERS.get(channelId);
  if (!scheduler?.timeout || (reason && scheduler.reason !== reason)) {
    return;
  }

  clearTimeout(scheduler.timeout);
  scheduler.timeout = undefined;
  scheduler.deadline = undefined;
  scheduler.reason = undefined;
}

function scheduleShortpollFromNow(channelId: string) {
  const scheduler = CHANNEL_SCHEDULERS.get(channelId);
  if (!scheduler?.isShortpollEligible || scheduler.shortpollTimeoutMs === undefined) {
    return;
  }

  scheduleChannelDifference(channelId, 'shortpoll', scheduler.shortpollTimeoutMs);
}

function restartShortpollFromNow(channelId: string) {
  const scheduler = CHANNEL_SCHEDULERS.get(channelId);
  if (!scheduler?.isShortpollEligible || scheduler.shortpollTimeoutMs === undefined || scheduler.isInFlight) {
    return;
  }

  if (scheduler.reason === 'shortpoll') {
    clearScheduledChannelDifference(channelId);
  }

  scheduleChannelDifference(channelId, 'shortpoll', scheduler.shortpollTimeoutMs);
}

function scheduleGetDifference(timeoutMs = UPDATE_WAIT_TIMEOUT) {
  if (seqTimeout) return;

  // PXG: The timer only waits for late updates; the request itself runs apart, so a failed or hung request never
  // leaves the timer set (which used to stop every later difference until reload)
  seqTimeout = setTimeout(() => {
    seqTimeout = undefined;
    void getDifference();
  }, timeoutMs);
}

/** PXG: The app is back in front, the network returned, or a chat turned out stale: catch up now */
export function requestDifference() {
  if (!isInited) {
    if (hasInvoke) void loadRemoteState();
    return;
  }

  clearTimeout(differenceRetryTimeout);
  differenceRetryTimeout = undefined;
  if (seqTimeout) {
    clearTimeout(seqTimeout);
    seqTimeout = undefined;
  }
  void getDifference();
  OPENED_CHANNEL_IDS.forEach((channelId) => requestChannelDifference(channelId));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PXG_DIFFERENCE_TIMEOUT')), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (err: unknown) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function getDifferenceTimeout() {
  return DIFFERENCE_TIMEOUTS_MS[Math.min(differenceFailures, DIFFERENCE_TIMEOUTS_MS.length - 1)];
}

function scheduleDifferenceRetry() {
  if (differenceRetryTimeout) return;
  const delay = DIFFERENCE_RETRY_DELAYS_MS[Math.min(differenceFailures - 1, DIFFERENCE_RETRY_DELAYS_MS.length - 1)];
  differenceRetryTimeout = setTimeout(() => {
    differenceRetryTimeout = undefined;
    void getDifference();
  }, delay);
}

function getUpdateChannelId(update: Update) {
  if ('channelId' in update && 'pts' in update) {
    return buildApiPeerId(update.channelId, 'channel');
  }

  if (update instanceof GramJs.UpdateNewChannelMessage || update instanceof GramJs.UpdateEditChannelMessage) {
    const peer = update.message.peerId as GramJs.PeerChannel;
    return buildApiPeerId(peer.channelId, 'channel');
  }

  return COMMON_BOX_QUEUE_ID;
}

export async function getDifference() {
  if (!isInited) {
    // PXG: Used to throw here and leave the scheduling timer set forever
    if (hasInvoke) void loadRemoteState();
    return;
  }

  if (isDifferenceInFlight) {
    isDifferenceRequestedAgain = true;
    return;
  }

  if (!localDb.commonBoxState?.date) {
    forceSync();
    return;
  }

  isDifferenceInFlight = true;
  isDifferenceRequestedAgain = false;
  const generation = ++differenceGeneration;

  sendApiUpdate({
    '@type': 'updateFetchingDifference',
    isFetching: true,
  });

  let isDone: boolean;
  try {
    isDone = await fetchDifferenceSlices(generation);
  } catch (err) {
    // A broken update must not stop the next ones: the difference is asked again
    // eslint-disable-next-line no-console
    console.error('[UpdatesManager] Failed to apply difference', err);
    isDone = false;
  } finally {
    if (generation === differenceGeneration) {
      isDifferenceInFlight = false;
      sendApiUpdate({
        '@type': 'updateFetchingDifference',
        isFetching: false,
      });
    }
  }

  if (generation !== differenceGeneration) return;

  if (!isDone) {
    differenceFailures++;
    scheduleDifferenceRetry();
    return;
  }

  differenceFailures = 0;
  // PXG: Updates that arrived while the difference was running wait in the queues for the next update, which may
  // never come in a quiet chat: apply what now fits, or ask again for what still does not
  popSeqQueue();
  popPtsQueue(COMMON_BOX_QUEUE_ID);

  if (isDifferenceRequestedAgain) {
    isDifferenceRequestedAgain = false;
    scheduleGetDifference(0);
  }
}

/** `true` — the state is current; `false` — the request failed or timed out and should be repeated */
async function fetchDifferenceSlices(generation: number): Promise<boolean> {
  while (generation === differenceGeneration) {
    let response: GramJs.updates.TypeDifference | undefined;
    try {
      response = await withTimeout(invoke(new GramJs.updates.GetDifference({
        pts: localDb.commonBoxState.pts,
        date: localDb.commonBoxState.date,
        qts: localDb.commonBoxState.qts,
      }), { shouldThrow: true }), getDifferenceTimeout());
    } catch (err) {
      if (generation !== differenceGeneration) return true;
      // Telegram refused the state itself: start over from the current one, as for a too long difference
      if (err instanceof RPCError) {
        forceSync();
        return true;
      }
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[UpdatesManager] Failed to get difference', err);
      }
      return false;
    }

    // Reset while waiting: the answer belongs to the previous state
    if (generation !== differenceGeneration || !isInited) return true;

    if (!response || response instanceof GramJs.updates.DifferenceTooLong) {
      forceSync();
      return true;
    }

    if (response instanceof GramJs.updates.DifferenceEmpty) {
      localDb.commonBoxState.seq = response.seq;
      localDb.commonBoxState.date = response.date;
      return true;
    }

    processDifference(response);

    const newState = response instanceof GramJs.updates.DifferenceSlice ? response.intermediateState : response.state;
    applyState(newState);

    if (!(response instanceof GramJs.updates.DifferenceSlice)) return true;
  }

  return true;
}

async function runChannelDifference(channelId: string, reason: ChannelDifferenceReason) {
  const scheduler = getOrCreateChannelScheduler(channelId);
  if (scheduler.isInFlight) {
    return;
  }

  scheduler.isInFlight = true;
  scheduler.reason = reason;

  try {
    await requestChannelDifferenceInternal(channelId, reason);
  } finally {
    scheduler.isInFlight = false;
  }
}

async function requestChannelDifferenceInternal(channelId: string, reason: ChannelDifferenceReason): Promise<void> {
  const channel = localDb.chats[channelId];
  if (
    !channel
    || !(channel instanceof GramJs.Channel)
    || !channel.accessHash
    || localDb.channelPtsById[channelId] === undefined
  ) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error('[UpdateManager] Channel for difference not found', channelId, channel);
    }
    return;
  }

  const limit = reason === 'shortpoll' ? SHORTPOLL_CHANNEL_DIFFERENCE_LIMIT : CATCH_UP_CHANNEL_DIFFERENCE_LIMIT;
  let response: GramJs.updates.TypeChannelDifference;

  try {
    // PXG: A request lost with the connection must not keep the channel "in flight" forever
    const result = await withTimeout(invoke(new GramJs.updates.GetChannelDifference({
      channel: buildInputChannel(channelId, channel.accessHash.toString()),
      pts: localDb.channelPtsById[channelId],
      filter: new GramJs.ChannelMessagesFilterEmpty(),
      limit,
    }), {
      shouldThrow: true,
    }), DIFFERENCE_TIMEOUTS_MS[0]);
    if (!result) {
      return;
    }

    response = result;
  } catch (err) {
    handleChannelDifferenceError(channelId, reason, err);
    return;
  }

  if (response instanceof GramJs.updates.ChannelDifferenceTooLong) {
    forceSync();
    return;
  }

  localDb.channelPtsById[channelId] = response.pts;
  updateChannelShortpollTimeout(channelId, response);

  if (response instanceof GramJs.updates.ChannelDifferenceEmpty) {
    if (response.final) {
      scheduleShortpollIfEligible(channelId);
    }

    popPtsQueue(channelId); // Continue processing updates in queue
    return;
  }

  processDifference(response, channelId);

  if (!response.final) {
    await requestChannelDifferenceInternal(channelId, 'gapRecovery');
    return;
  }

  scheduleShortpollIfEligible(channelId);
}

function updateChannelShortpollTimeout(channelId: string, response: GramJs.updates.TypeChannelDifference) {
  const scheduler = getOrCreateChannelScheduler(channelId);
  scheduler.shortpollTimeoutMs = ('timeout' in response && response.timeout)
    ? response.timeout * 1000
    : SHORTPOLL_DEFAULT_TIMEOUT_MS;
}

function scheduleShortpollIfEligible(channelId: string) {
  const scheduler = getOrCreateChannelScheduler(channelId);
  if (!scheduler.isShortpollEligible) {
    return;
  }

  scheduleShortpollFromNow(channelId);
}

function handleChannelDifferenceError(channelId: string, reason: ChannelDifferenceReason, err: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.warn('[UpdatesManager] Failed to get ChannelDifference', channelId, err);
  }

  const scheduler = getOrCreateChannelScheduler(channelId);
  const errorMessage = err instanceof RPCError ? err.errorMessage : undefined;

  if (errorMessage && TERMINAL_CHANNEL_DIFFERENCE_ERRORS.has(errorMessage)) {
    scheduler.isShortpollEligible = false;
    clearScheduledChannelDifference(channelId);
    return;
  }

  scheduleChannelDifference(channelId, reason, CHANNEL_DIFFERENCE_RETRY_TIMEOUT_MS);
}

function forceSync() {
  reset();

  sendApiUpdate({
    '@type': 'requestSync',
  });

  void loadRemoteState();
}

export function reset() {
  PTS_QUEUE.clear();
  SEQ_QUEUE.clear();

  clearTimeout(seqTimeout);
  seqTimeout = undefined;
  // PXG: A difference still on its way belongs to the old state and is ignored when it answers
  differenceGeneration++;
  isDifferenceInFlight = false;
  isDifferenceRequestedAgain = false;
  differenceFailures = 0;
  clearTimeout(differenceRetryTimeout);
  differenceRetryTimeout = undefined;
  clearTimeout(remoteStateRetryTimeout);
  remoteStateRetryTimeout = undefined;
  remoteStateFailures = 0;

  CHANNEL_SCHEDULERS.forEach(({ timeout }) => {
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
  });
  CHANNEL_SCHEDULERS.clear();
  OPENED_CHANNEL_IDS.clear();

  // PXG: Cleared in place: the object reports its changes to the page, which hands the state back when the API is
  // recreated. A new plain object would stop reporting, and the page would keep an outdated state
  const commonBoxState = localDb.commonBoxState as Record<string, number | undefined>;
  Object.keys(commonBoxState).forEach((key) => {
    commonBoxState[key] = undefined;
  });

  Object.keys(localDb.channelPtsById).forEach((channelId) => {
    localDb.channelPtsById[channelId] = 0;
  });

  isInited = false;
}

export function processAffectedHistory(
  chat: ApiChat, affected: GramJs.messages.AffectedMessages | GramJs.messages.AffectedHistory,
) {
  const isChannel = chat.type === 'chatTypeChannel' || chat.type === 'chatTypeSuperGroup';
  const channeId = isChannel ? buildMtpPeerId(chat.id, 'channel') : undefined;
  const update = buildLocalUpdatePts(affected.pts, affected.ptsCount, channeId);

  processUpdate(update);
}

/**
 * PXG: The state is retried until it loads. A single failure (the connection was down at that moment) used to leave
 * the manager uninitialized, dropping every update until the app was restarted
 */
async function loadRemoteState(): Promise<boolean> {
  if (isLoadingRemoteState) return false;
  isLoadingRemoteState = true;
  clearTimeout(remoteStateRetryTimeout);
  remoteStateRetryTimeout = undefined;

  let remoteState: GramJs.updates.State | undefined;
  try {
    remoteState = await withTimeout(invoke(new GramJs.updates.GetState()), getDifferenceTimeout());
  } catch {
    remoteState = undefined;
  } finally {
    isLoadingRemoteState = false;
  }

  if (!remoteState) {
    const delay = REMOTE_STATE_RETRY_DELAYS_MS[Math.min(remoteStateFailures, REMOTE_STATE_RETRY_DELAYS_MS.length - 1)];
    remoteStateFailures++;
    remoteStateRetryTimeout = setTimeout(() => {
      remoteStateRetryTimeout = undefined;
      void loadRemoteState();
    }, delay);
    return false;
  }

  const wasInited = isInited;
  remoteStateFailures = 0;
  applyState(remoteState);
  isInited = true;

  // A state that loaded only on a retry: whatever came meanwhile arrives with the difference
  if (!wasInited) scheduleGetDifference();

  return true;
}

function processDifference(
  difference: GramJs.updates.Difference | GramJs.updates.DifferenceSlice | GramJs.updates.ChannelDifference,
  channelId?: string,
) {
  difference.newMessages.forEach((message) => {
    updater(new GramJs.UpdateNewMessage({
      message,
      pts: 0,
      ptsCount: 0,
    }));
  });

  processAndUpdateEntities(difference);

  // Ignore `pts`/`seq` holes when applying updates from difference
  // BUT, if we got an `UpdateChannelTooLong`, make sure to process other updates after receiving `ChannelDifference`
  const channelTooLongIds = new Set<string>();

  difference.otherUpdates.forEach((update) => {
    const updateChannelId = getUpdateChannelId(update);

    if (update instanceof GramJs.UpdateChannelTooLong) {
      channelTooLongIds.add(getUpdateChannelId(update));
    }

    const shouldApplyImmediately = !channelTooLongIds.has(updateChannelId);
    processUpdate(update, shouldApplyImmediately, !shouldApplyImmediately);
  });

  // Continue processing updates in queues
  if (channelId) {
    popPtsQueue(channelId);
  } else {
    popSeqQueue();
  }
}

function getPtsCount(update: PtsUpdate) {
  return 'ptsCount' in update ? update.ptsCount : 0;
}

function seqComparator(a: SeqUpdate, b: SeqUpdate) {
  const seqA = 'seqStart' in a ? a.seqStart : a.seq;
  const seqB = 'seqStart' in b ? b.seqStart : b.seq;

  return seqA - seqB;
}

function ptsComparator(a: PtsUpdate, b: PtsUpdate) {
  const diff = a.pts - b.pts;
  if (diff !== 0) {
    return diff;
  }

  return getPtsCount(b) - getPtsCount(a);
}
