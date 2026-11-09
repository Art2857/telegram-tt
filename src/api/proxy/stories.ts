import type { PeerStoriesDto, StoryDto } from '../../proxygram/server/types';
import type { ApiPeerStories, ApiStory, ApiTypeStory, MediaContent } from '../types';

import { pxgRpc } from '../../proxygram/server/rpc';
import { getProxyPeerId, resolveProxyPeer } from './index';

/** Истории открытых чатов: медиа приходит готовым data: URL, Web A рисует обычным просмотрщиком */
export async function fetchAllStories(): Promise<{
  peerStories: Record<string, ApiPeerStories>;
  hasMore: false;
  state: string;
  stealthMode: Record<string, never>;
}> {
  const { peers } = await pxgRpc.call<{ peers: PeerStoriesDto[] }>('stories.list');
  const peerStories: Record<string, ApiPeerStories> = {};

  for (const peer of peers) {
    const chatId = getProxyPeerId(peer.accountId, peer.peerId);
    const byId: Record<number, ApiTypeStory> = {};
    const orderedIds: number[] = [];
    for (const dto of peer.stories) {
      if (!dto.mediaUrl) continue;
      const story = buildStory(dto, chatId);
      byId[story.id] = story;
      orderedIds.push(story.id);
    }
    if (!orderedIds.length) continue;
    peerStories[chatId] = {
      byId,
      orderedIds,
      profileIds: [],
      lastReadId: peer.lastReadId,
      lastUpdatedAt: Math.max(...peer.stories.map((story) => Math.floor(Date.parse(story.date) / 1000))),
    };
  }

  return { peerStories, hasMore: false, state: 'pxg', stealthMode: {} };
}

/** Истории одного собеседника: Web A просит их при открытии истории */
export async function fetchPeerStories({ peer }: { peer: { id: string } }) {
  const { peerStories } = await fetchAllStories();
  const stories = peerStories[peer.id];
  return stories ? { stories: stories.byId, lastReadStoryId: stories.lastReadId } : { stories: {}, lastReadStoryId: 0 };
}

/** Точечное обновление историй: истории прокси не удаляются, поэтому просто отдаём известные */
export async function fetchPeerStoriesByIds({ peer, ids }: { peer: { id: string }; ids: number[] }) {
  const { stories } = await fetchPeerStories({ peer });
  return {
    stories: Object.fromEntries(ids.flatMap((id) => (stories[id] ? [[id, stories[id]]] : []))),
  };
}

/** Отметить историю прочитанной: просмотр остаётся у владельца */
export async function markStoryRead({ peer, storyId }: { peer: { id: string }; storyId: number }) {
  const proxyPeer = resolveProxyPeer(peer.id);
  if (!proxyPeer) return undefined;
  await pxgRpc.call('stories.read', { ...proxyPeer, maxId: storyId });
  return [storyId];
}

/** Просмотр засчитывается владельцу: stories.incrementStoryViews от его имени */
export function viewStory({ peer, storyId }: { peer: { id: string }; storyId: number }) {
  const proxyPeer = resolveProxyPeer(peer.id);
  if (!proxyPeer) return Promise.resolve(false);
  return pxgRpc.call('stories.view', { ...proxyPeer, ids: [storyId] })
    .then(() => true)
    .catch(() => false);
}

function buildStory(dto: StoryDto, peerId: string): ApiStory {
  const date = Math.floor(Date.parse(dto.date) / 1000);
  const expireDate = Math.floor(Date.parse(dto.expireDate) / 1000);
  const content: MediaContent = {};
  if (dto.mimeType.startsWith('video/')) {
    content.video = {
      mediaType: 'video',
      id: `pxg-story-${dto.id}`,
      mimeType: dto.mimeType,
      duration: dto.duration ?? 0,
      fileName: `story-${dto.id}.mp4`,
      width: dto.width,
      height: dto.height,
      size: 0,
      supportsStreaming: true,
    };
  } else {
    content.photo = {
      mediaType: 'photo',
      id: `pxg-story-${dto.id}`,
      date,
      sizes: [{ type: 'x', width: dto.width ?? 1080, height: dto.height ?? 1920 }],
    };
  }
  if (dto.caption) {
    content.text = { text: dto.caption, entities: [] };
  }

  return {
    id: dto.id,
    peerId,
    date,
    expireDate,
    content,
    isInProfile: dto.isPinned || undefined,
    mediaUrl: dto.mediaUrl,
  };
}
