import { loggerService } from '@logger'
import { useAppDispatch } from '@renderer/store'
import { cloneMessagesToNewTopicThunk } from '@renderer/store/thunk/messageThunk'
import type { Topic } from '@renderer/types'
import { useCallback } from 'react'

const logger = loggerService.withContext('UseMessageBranching')

/**
 * Hook 提供消息分支相关操作
 */
export function useMessageBranching() {
  const dispatch = useAppDispatch()

  /**
   * 创建主题分支，克隆消息到新主题。 / Creates a topic branch by cloning messages to a new topic.
   * @param sourceTopicId 源主题ID / Source topic ID
   * @param branchPointIndex 分支点索引，此索引之前的消息将被克隆 / Branch point index, messages before this index will be cloned
   * @param newTopic 新的主题对象，必须已经创建并添加到Redux store中 / New topic object, must be already created and added to Redux store
   * @returns 操作是否成功 / Whether the operation was successful
   */
  const createTopicBranch = useCallback(
    (sourceTopicId: string, branchPointIndex: number, newTopic: Topic) => {
      logger.info(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  return {
    createTopicBranch
  }
}
