import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { Assistant } from '@renderer/types'
import { Topic } from '@renderer/types'
import { use, useEffect, useMemo, useState } from 'react'
import { createContext } from 'react'

import { useTopicsForAssistant } from './useAssistant'
import { useSettings } from './useSettings'

interface ChatContextType {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveAssistant: (assistant: Assistant) => void
  setActiveTopic: (topic: Topic) => void
}

const ChatContext = createContext<ChatContextType | null>(null)

export const ChatProvider = ({ children }) => {
  const assistants = useAppSelector((state) => state.assistants.assistants)
  const [activeAssistant, setActiveAssistant] = useState<Assistant>(assistants[0])
  const topics = useTopicsForAssistant(activeAssistant.id)
  const [activeTopic, setActiveTopic] = useState<Topic>(topics[0])
  const { clickAssistantToShowTopic } = useSettings()
  const dispatch = useAppDispatch()

  console.log('activeAssistant', activeAssistant)
  console.log('activeTopic', activeTopic)

  // 当 topics 变化时，如果当前 activeTopic 不在 topics 中，设置第一个 topic
  useEffect(() => {
    if (!topics.find((topic) => topic.id === activeTopic?.id)) {
      const firstTopic = topics[0]
      firstTopic && setActiveTopic(firstTopic)
    }
  }, [topics, activeTopic?.id])

  // 当 activeTopic 变化时加载消息
  useEffect(() => {
    if (activeTopic) {
      dispatch(loadTopicMessagesThunk(activeTopic.id))
      EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic, dispatch])

  // 处理点击助手显示话题侧边栏
  useEffect(() => {
    if (clickAssistantToShowTopic) {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  }, [clickAssistantToShowTopic, activeAssistant])

  useEffect(() => {
    const subscriptions = [
      EventEmitter.on(EVENT_NAMES.SET_ASSISTANT, setActiveAssistant),
      EventEmitter.on(EVENT_NAMES.SET_TOPIC, setActiveTopic)
    ]
    return () => subscriptions.forEach((subscription) => subscription())
  }, [])

  const value = useMemo(
    () => ({
      activeAssistant,
      activeTopic,
      setActiveAssistant,
      setActiveTopic
    }),
    [activeAssistant, activeTopic]
  )

  return <ChatContext value={value}>{children}</ChatContext>
}

export const useChat = () => {
  const context = use(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within ChatProvider')
  }
  return context
}
