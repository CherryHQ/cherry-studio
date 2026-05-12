import type { Topic } from '@renderer/types'
import type { FC } from 'react'

import { TopicListV2 } from './components/TopicListV2'

interface Props {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const TopicsTab: FC<Props> = (props) => {
  return <TopicListV2 {...props} />
}

export default TopicsTab
