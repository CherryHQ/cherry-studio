import { AppDispatch, RootState } from '@renderer/store'
import { finishRenaming, renameTopic as renameTopicAction, startRenaming } from '@renderer/store/topics'
import { Topic } from '@renderer/types'
import { useDispatch, useSelector } from 'react-redux'

import { useSettings } from './useSettings'

// Hook for topic-related actions
export const useTopicActions = () => {
  const dispatch = useDispatch<AppDispatch>()
  const renamingTopicIds = useSelector((state: RootState) => state.topics.renamingTopicIds)
  const { enableTopicNaming } = useSettings()

  // Get current renaming state for a specific topic
  const isRenaming = (topicId: string) => renamingTopicIds.includes(topicId)

  return {
    // Topic renaming methods
    startRenaming: (topicId: string) => dispatch(startRenaming(topicId)),
    finishRenaming: (topicId: string) => dispatch(finishRenaming(topicId)),
    isRenaming,
    renamingTopicIds,

    // Rename topic method
    renameTopic: (
      assistant: any,
      topic: Topic,
      messages: any[],
      setActiveTopic: (topic: Topic) => void,
      updateTopic: (topic: Topic) => void
    ) => dispatch(renameTopicAction(assistant, topic, messages, setActiveTopic, updateTopic, enableTopicNaming))
  }
}
