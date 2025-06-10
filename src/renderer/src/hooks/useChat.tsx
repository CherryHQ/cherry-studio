import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setActiveAssistant, setActiveTopic } from '@renderer/store/runtime'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { Assistant } from '@renderer/types'
import { Topic } from '@renderer/types'
import { useEffect } from 'react'

import { useAssistants } from './useAssistant'
import { useSettings } from './useSettings'

export const useChat = () => {
  const { assistants } = useAssistants()
  const activeAssistant = useAppSelector((state) => state.runtime.chat.activeAssistant) || assistants[0]
  const activeTopic = useAppSelector((state) => state.runtime.chat.activeTopic) || activeAssistant?.topics[0]!
  const { clickAssistantToShowTopic } = useSettings()
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (activeTopic) {
      dispatch(loadTopicMessagesThunk(activeTopic.id))
      EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic, dispatch])

  useEffect(() => {
    const firstTopic = activeAssistant.topics[0]
    firstTopic && dispatch(setActiveTopic(firstTopic))
  }, [activeAssistant, dispatch])

  useEffect(() => {
    if (clickAssistantToShowTopic) {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  }, [clickAssistantToShowTopic, activeAssistant])

  return {
    activeAssistant,
    activeTopic,
    setActiveAssistant: (assistant: Assistant) => {
      dispatch(setActiveAssistant(assistant))
    },
    setActiveTopic: (topic: Topic) => {
      dispatch(setActiveTopic(topic))
    }
  }
}
