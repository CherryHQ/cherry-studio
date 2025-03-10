import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  clearStreamMessage,
  clearTopicMessages,
  commitStreamMessage,
  resendMessage,
  selectDisplayCount,
  selectTopicLoading,
  selectTopicMessages,
  setStreamMessage,
  updateMessage,
  updateMessages
} from '@renderer/store/messages'
import type { Assistant, Message, Topic } from '@renderer/types'
import { useCallback } from 'react'
/**
 * 自定义Hook，提供消息操作相关的功能
 *
 * @param topic 当前主题
 * @returns 一组消息操作方法
 */
export function useMessageOperations(topic: Topic) {
  const dispatch = useAppDispatch()
  const messages = useAppSelector((state) => selectTopicMessages(state, topic.id))

  /**
   * 删除单个消息
   */
  const deleteMessage = useCallback(
    async (message: Message) => {
      const newMessages = messages.filter((m) => m.id !== message.id)
      await dispatch(updateMessages(topic, newMessages))
    },
    [dispatch, topic, messages]
  )

  /**
   * 删除一组消息（基于askId）
   */
  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      const newMessages = messages.filter((m) => m.askId !== askId)
      await dispatch(updateMessages(topic, newMessages))
    },
    [dispatch, topic, messages]
  )

  /**
   * 编辑消息内容
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Message>) => {
      await dispatch(
        updateMessage({
          topicId: topic.id,
          messageId,
          updates
        })
      )
    },
    [dispatch, topic.id]
  )

  /**
   * 重新发送消息
   */
  const resendMessageAction = useCallback(
    async (message: Message, assistant: Assistant, isMentionModel = false) => {
      return dispatch(resendMessage(message, assistant, topic, isMentionModel))
    },
    [dispatch, topic]
  )

  /**
   * 重新发送用户消息（编辑后）
   */
  const resendUserMessageWithEdit = useCallback(
    async (message: Message, editedContent: string, assistant: Assistant) => {
      // 先更新消息内容
      await editMessage(message.id, { content: editedContent })
      // 然后重新发送
      return dispatch(resendMessage({ ...message, content: editedContent }, assistant, topic))
    },
    [dispatch, editMessage, topic]
  )

  /**
   * 设置流式消息
   */
  const setStreamMessageAction = useCallback(
    (message: Message | null) => {
      dispatch(setStreamMessage({ topicId: topic.id, message }))
    },
    [dispatch, topic.id]
  )

  /**
   * 提交流式消息
   */
  const commitStreamMessageAction = useCallback(
    (messageId: string) => {
      dispatch(commitStreamMessage({ topicId: topic.id, messageId }))
    },
    [dispatch, topic.id]
  )

  /**
   * 清除流式消息
   */
  const clearStreamMessageAction = useCallback(
    (messageId: string) => {
      dispatch(clearStreamMessage({ topicId: topic.id, messageId }))
    },
    [dispatch, topic.id]
  )

  /**
   * 清除会话消息
   */
  const clearTopicMessagesAction = useCallback(
    async (_topicId?: string) => {
      await dispatch(clearTopicMessages(_topicId || topic.id))
    },
    [dispatch, topic.id]
  )

  /**
   * 更新消息数据
   */
  const updateMessagesAction = useCallback(
    async (messages: Message[]) => {
      await dispatch(updateMessages(topic, messages))
    },
    [dispatch, topic]
  )

  /**
   * 创建新的上下文（clear message）
   */
  const createNewContext = useCallback(async () => {
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const loading = useAppSelector((state) => selectTopicLoading(state, topic.id))
  const displayCount = useAppSelector(selectDisplayCount)
  // /**
  //  * 获取当前消息列表
  //  */
  // const getMessages = useCallback(() => messages, [messages])

  return {
    messages,
    loading,
    displayCount,
    updateMessages: updateMessagesAction,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage: resendMessageAction,
    resendUserMessageWithEdit,
    setStreamMessage: setStreamMessageAction,
    commitStreamMessage: commitStreamMessageAction,
    clearStreamMessage: clearStreamMessageAction,
    createNewContext,
    clearTopicMessages: clearTopicMessagesAction
  }
}
