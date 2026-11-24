/** Encode a semantic ID's UTF-8 bytes as one cache-template segment. */
export function cacheKeySegment(key: string): string {
  return Array.from(new TextEncoder().encode(key), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function topicStreamStatusCacheKey(topicId: string): `topic.stream.statuses.${string}` {
  return `topic.stream.statuses.${cacheKeySegment(topicId)}`
}

export function topicLastSeenCompletionCacheKey(topicId: string): `topic.stream.last_seen_completion.${string}` {
  return `topic.stream.last_seen_completion.${cacheKeySegment(topicId)}`
}

export function topicScrollAnchorCacheKey(topicId: string): `chat.scroll_anchor.${string}` {
  return `chat.scroll_anchor.${cacheKeySegment(topicId)}`
}
