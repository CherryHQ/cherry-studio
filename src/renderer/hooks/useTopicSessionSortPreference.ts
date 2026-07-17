import { usePreference } from '@renderer/data/hooks/usePreference'
import type { TopicSessionSortBy } from '@shared/data/preference/preferenceTypes'
import { useEffect } from 'react'

type TopicSessionSortPreferenceKey = 'agent.session.sort_type' | 'topic.sort_type'

/** Lazily rewrite the pre-lastActivityAt preference value without main-process migration infrastructure. */
export function useTopicSessionSortPreference(key: TopicSessionSortPreferenceKey) {
  const [storedSortBy, setSortBy] = usePreference(key)
  const isLegacyActivitySort = (storedSortBy as TopicSessionSortBy | 'updatedAt') === 'updatedAt'
  const sortBy: TopicSessionSortBy = isLegacyActivitySort ? 'lastActivityAt' : storedSortBy

  useEffect(() => {
    if (isLegacyActivitySort) {
      void setSortBy('lastActivityAt').catch(() => undefined)
    }
  }, [isLegacyActivitySort, setSortBy])

  return [sortBy, setSortBy] as const
}
