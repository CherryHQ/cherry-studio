import type { Topic } from '@renderer/types'
import type { FC } from 'react'

import { Topics } from './components/Topics'

interface Props {
  activeTopic: Topic
  onOpenHistory?: () => void
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const TopicsTab: FC<Props> = (props) => {
  return <Topics {...props} />
}

export default TopicsTab
