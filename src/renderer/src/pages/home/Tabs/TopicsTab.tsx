import { useRuntime } from '@renderer/hooks/useRuntime'
import { Assistant, Topic } from '@renderer/types'
import { FC } from 'react'

import { Topics } from './components/Topics'
import SessionsTab from './SessionsTab'

// const logger = loggerService.withContext('TopicsTab')

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const TopicsTab: FC<Props> = (props) => {
  const { chat } = useRuntime()
  const { activeTopicOrSession } = chat
  if (activeTopicOrSession === 'topic') {
    return <Topics {...props} />
  }
  if (activeTopicOrSession === 'session') {
    return <SessionsTab />
  }
  return 'Not a valid state.'
}

export default TopicsTab
