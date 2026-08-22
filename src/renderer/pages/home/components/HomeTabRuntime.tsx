import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import type { Topic } from '@renderer/types/topic'
import { useEffect } from 'react'

type Props = {
  title: string
  emoji?: string | null
  preserveVisuals: boolean
  activeTopic?: Topic | null
  activeTopicSource: string
}

export function HomeTabRuntime({ title, emoji, preserveVisuals, activeTopic, activeTopicSource }: Props) {
  const isActiveTab = useIsActiveTab()
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')

  useTabSelfVisuals({
    title,
    emoji,
    appId: 'assistants',
    preserveVisuals
  })

  useEffect(() => {
    if (!isActiveTab) return
    if (activeTopic?.id && activeTopicSource === 'query') {
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  return null
}
