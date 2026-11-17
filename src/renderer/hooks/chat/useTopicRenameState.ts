import { useCallback, useSyncExternalStore } from 'react'

import { cacheService } from '@renderer/data/CacheService'

const subscribe = (onStoreChange: () => void) => {
  const unsubscribeRenaming = cacheService.subscribe('topic.renaming', onStoreChange)
  const unsubscribeNewlyRenamed = cacheService.subscribe('topic.newly_renamed', onStoreChange)
  return () => {
    unsubscribeRenaming()
    unsubscribeNewlyRenamed()
  }
}

export function useTopicRenameState(topicId: string) {
  const getSnapshot = useCallback(
    () =>
      (cacheService.get('topic.renaming')?.includes(topicId) ? 1 : 0) |
      (cacheService.get('topic.newly_renamed')?.includes(topicId) ? 2 : 0),
    [topicId]
  )
  // A primitive snapshot lets React ignore changes belonging to other topics.
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { isRenaming: Boolean(state & 1), isNewlyRenamed: Boolean(state & 2) }
}
