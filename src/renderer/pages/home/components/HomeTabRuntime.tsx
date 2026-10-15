import { useEffect } from 'react'

import { cacheService } from '@data/CacheService'
import { useCloseConversationTabs, useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import type { ActiveTopicSource } from '@renderer/hooks/useTopic'
import { useIpcOn } from '@renderer/ipc'

type Props = {
  title: string
  emoji?: string | null
  preserveVisuals: boolean
  activeTopicId?: string | null
  activeTopicSource: ActiveTopicSource
}

export function HomeTabRuntime({ title, emoji, preserveVisuals, activeTopicId, activeTopicSource }: Props) {
  const isActiveTab = useIsActiveTab()
  const closeConversationTabs = useCloseConversationTabs()
  useIpcOn('quick_assistant.chat.expired', ({ topicIds }) => {
    closeConversationTabs('assistants', topicIds)
  })

  useTabSelfVisuals({
    title,
    emoji,
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
