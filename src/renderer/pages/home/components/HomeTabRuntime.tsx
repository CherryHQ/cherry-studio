import { useEffect } from 'react'

import { cacheService } from '@data/CacheService'
import { useIsActiveTab } from '@renderer/hooks/tab'
import type { ActiveTopicSource } from '@renderer/hooks/useTopic'

type Props = {
  activeTopicId?: string | null
  activeTopicSource: ActiveTopicSource
}

export function HomeTabRuntime({ activeTopicId, activeTopicSource }: Props) {
  const isActiveTab = useIsActiveTab()

  useEffect(() => {
    if (!isActiveTab) return
    if (activeTopicId && activeTopicSource === 'query') {
      cacheService.setPersist('ui.chat.last_used_topic_id', activeTopicId)
    }
  }, [isActiveTab, activeTopicId, activeTopicSource])

  return null
}
