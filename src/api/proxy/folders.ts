import type { MethodArgs } from '../gramjs/methods/types';
import type { ApiChatFolder } from '../types';

import { ALL_FOLDER_ID } from '../../config';
import { pxgRpc } from '../../proxygram/server/rpc';
import { emitProxyUpdate, getProxyPeerId, resolveProxyPeer } from './index';

type FolderPeer = { accountId: string; peerId: number };
type FolderDto = Omit<ApiChatFolder, 'title' | 'includedChatIds' | 'excludedChatIds' | 'pinnedChatIds'> & {
  title: string;
  titleEntities?: ApiChatFolder['title']['entities'];
  included: FolderPeer[];
  excluded: FolderPeer[];
  pinned: FolderPeer[];
};

export async function fetchChatFolders() {
  const folders = await pxgRpc.call<FolderDto[]>('folders.list');
  return {
    byId: Object.fromEntries(folders.map((folder) => [folder.id, buildFolder(folder)])),
    orderedIds: [ALL_FOLDER_ID, ...folders.map((folder) => folder.id)],
    areTagsEnabled: undefined,
  };
}

export async function editChatFolder({ id, folderUpdate }: MethodArgs<'editChatFolder'>[0]) {
  const { title, includedChatIds, excludedChatIds, pinnedChatIds, ...rest } = folderUpdate;
  const excluded = excludedChatIds.filter((chatId) => !includedChatIds.includes(chatId));
  await pxgRpc.call('folders.save', { folder: {
    ...rest, id, title: title.text, titleEntities: title.entities,
    included: resolvePeers(includedChatIds), excluded: resolvePeers(excluded),
    pinned: resolvePeers(pinnedChatIds || []),
  } });
  emitProxyUpdate({
    '@type': 'updateChatFolder', id, folder: { ...folderUpdate, excludedChatIds: excluded },
  });
}

export async function deleteChatFolder(id: number) {
  await pxgRpc.call('folders.delete', { id });
  emitProxyUpdate({ '@type': 'updateChatFolder', id, folder: undefined });
}

export async function sortChatFolders(ids: number[]) {
  await pxgRpc.call('folders.order', { ids: ids.filter((id) => id !== ALL_FOLDER_ID) });
  return true as const;
}

export function fetchRecommendedChatFolders() {
  return Promise.resolve([]);
}

function buildFolder({ title, titleEntities, included, excluded, pinned, ...rest }: FolderDto): ApiChatFolder {
  return {
    ...rest, title: { text: title, entities: titleEntities },
    includedChatIds: included.map(resolvePeerId), excludedChatIds: excluded.map(resolvePeerId),
    pinnedChatIds: pinned.map(resolvePeerId),
  };
}

function resolvePeers(ids: string[]) {
  return ids.map((id) => {
    const peer = resolveProxyPeer(id);
    if (!peer) throw new Error('Unknown shared chat');
    return peer;
  });
}

function resolvePeerId({ accountId, peerId }: FolderPeer) {
  return getProxyPeerId(accountId, peerId);
}
