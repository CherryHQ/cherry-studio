import { cacheService } from '@data/CacheService'
import { useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import type { ActiveTopicSource } from '@renderer/hooks/useTopic'
import { useEffect } from 'react'

type Props = {
  title: string
  emoji?: string | null
  preserveVisuals: boolean
  entityId?: string
  activeTopicId?: string | null
  activeTopicSource: ActiveTopicSource
}

export function HomeTabRuntime({ title, emoji, preserveVisuals, entityId, activeTopicId, activeTopicSource }: Props) {
  const isActiveTab = useIsActiveTab()

  useTabSelfVisuals({
    title,
    emoji,
    appId: 'assistants',
    preserveVisuals,
    entityId
  })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeTopicId && activeTopicSource === 'query') {
      cacheService.setPersist('ui.chat.last_used_topic_id', activeTopicId)
    }
  }, [isActiveTab, activeTopicId, activeTopicSource])

  return null
}
