import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import type { Topic } from '@renderer/types'
import { find } from 'lodash'
import { useEffect, useState } from 'react'

import { useAssistant } from './useAssistant'

// FIXME: Not a good practice. May use redux state.
export let _activeTopic: Topic
export let _setActiveTopic: (topic: Topic) => void

export function useActiveTopic(assistantId: string, topic?: Topic) {
  const { assistant } = useAssistant(assistantId)
  const [activeTopic, setActiveTopic] = useState(topic || _activeTopic || assistant?.topics[0])

  _activeTopic = activeTopic
  _setActiveTopic = setActiveTopic

  useEffect(() => {
    if (activeTopic) {
      store.dispatch(loadTopicMessagesThunk(activeTopic.id))
      EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic])

  useEffect(() => {
    // activeTopic not in assistant.topics
    // 确保 assistant 和 assistant.topics 存在，避免在数据未完全加载时访问属性
    if (
      assistant &&
      assistant.topics &&
      Array.isArray(assistant.topics) &&
      assistant.topics.length > 0 &&
      !find(assistant.topics, { id: activeTopic?.id })
    ) {
      setActiveTopic(assistant.topics[0])
    }
  }, [activeTopic?.id, assistant])

  return { activeTopic, setActiveTopic }
}
