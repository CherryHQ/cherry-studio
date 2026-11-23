import { useEffect } from 'react'

import { cacheService } from '@data/CacheService'
import { useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import type { ActiveTopicSource } from '@renderer/hooks/useTopic'

type Props = {
  title: string
  emoji?: string | null
  /** An uploaded avatar, shown instead of the emoji. */
  icon?: string
  preserveVisuals: boolean
  activeTopicId?: string | null
  activeTopicSource: ActiveTopicSource
}

export function HomeTabRuntime({ title, emoji, icon, preserveVisuals, activeTopicId, activeTopicSource }: Props) {
  const isActiveTab = useIsActiveTab()

  useTabSelfVisuals({
    title,
    emoji,
    icon,
    routePrefix: '/app/chat',
    preserveVisuals
  })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeTopicId && activeTopicSource === 'query') {
      cacheService.setPersist('ui.chat.last_used_topic_id', activeTopicId)
    }
  }, [isActiveTab, activeTopicId, activeTopicSource])

  return null
}
