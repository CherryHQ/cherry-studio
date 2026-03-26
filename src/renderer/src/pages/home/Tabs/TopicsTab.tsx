import type { Assistant, Topic } from '@renderer/types'
import type { FC } from 'react'

import { Topics } from './components/Topics'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const TopicsTab: FC<Props> = (props) => {
  return <Topics {...props} />
}

export default TopicsTab
