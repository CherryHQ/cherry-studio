import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import db from '@renderer/databases'
import { autoRenameTopic, TopicManager } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, resetAssistantMessage } from '@renderer/services/MessagesService'
import type { AppDispatch, RootState } from '@renderer/store'
import type { Assistant, Message, Topic } from '@renderer/types'
import { Model } from '@renderer/types'
import { clearTopicQueue, getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'
import { cloneDeep, isEmpty, throttle } from 'lodash'

export interface MessagesState {
  messagesByTopic: Record<string, Message[]>
  streamMessagesByTopic: Record<string, Record<string, Message | null>>
  currentTopic: Topic | null
  loadingByTopic: Record<string, boolean> // 每个会话独立的loading状态
  displayCount: number
  error: string | null
}

const initialState: MessagesState = {
  messagesByTopic: {},
  streamMessagesByTopic: {},
  currentTopic: null,
  loadingByTopic: {},
  displayCount: 20,
  error: null
}

// 新增准备会话消息的函数，实现懒加载机制
export const prepareTopicMessages = createAsyncThunk(
  'messages/prepareTopic',
  async (topic: Topic, { dispatch, getState }) => {
    try {
      const state = getState() as RootState
      const hasMessageInStore = !!state.messages.messagesByTopic[topic.id]

      // 如果消息不在 Redux store 中，从数据库加载
      if (!hasMessageInStore) {
        // 从数据库加载
        await loadTopicMessagesThunk(topic)(dispatch as AppDispatch)
      }

      // 设置为当前会话
      dispatch(setCurrentTopic(topic))

      return true
    } catch (error) {
      console.error('Failed to prepare topic messages:', error)
      return false
    }
  }
)

const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setTopicLoading: (state, action: PayloadAction<{ topicId: string; loading: boolean }>) => {
      const { topicId, loading } = action.payload
      state.loadingByTopic[topicId] = loading
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    setDisplayCount: (state, action: PayloadAction<number>) => {
      state.displayCount = action.payload
    },
    addMessage: (state, action: PayloadAction<{ topicId: string; messages: Message | Message[] }>) => {
      const { topicId, messages } = action.payload

      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }

      if (Array.isArray(messages)) {
        // 为了兼容多模型新发消息,一次性添加多个助手消息
        // 不是什么好主意,不符合语义
        state.messagesByTopic[topicId].push(...messages)
      } else {
        // 添加单条消息
        state.messagesByTopic[topicId].push(messages)
      }
    },
    appendMessage: (
      state,
      action: PayloadAction<{ topicId: string; messages: Message | Message[]; position?: number }>
    ) => {
      const { topicId, messages, position } = action.payload

      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }

      // 确保消息数组存在并且拿到引用
      const messagesList = state.messagesByTopic[topicId]

      // 要插入的消息
      const messagesToInsert = Array.isArray(messages) ? messages : [messages]

      if (position !== undefined && position >= 0 && position <= messagesList.length) {
        // 如果指定了位置，在特定位置插入消息
        messagesList.splice(position, 0, ...messagesToInsert)
      } else {
        // 否则默认添加到末尾
        messagesList.push(...messagesToInsert)
      }
    },
    updateMessage: (
      state,
      action: PayloadAction<{ topicId: string; messageId: string; updates: Partial<Message> }>
    ) => {
      const { topicId, messageId, updates } = action.payload
      const topicMessages = state.messagesByTopic[topicId]

      if (topicMessages) {
        const message = topicMessages.find((msg) => msg.id === messageId)
        if (message) {
          Object.assign(message, updates)
          db.topics.update(topicId, {
            messages: topicMessages.map((m) => (m.id === message.id ? cloneDeep(message) : cloneDeep(m)))
          })
        }
      }
    },
    setCurrentTopic: (state, action: PayloadAction<Topic | null>) => {
      state.currentTopic = action.payload
    },
    clearTopicMessages: (state, action: PayloadAction<string>) => {
      const topicId = action.payload
      state.messagesByTopic[topicId] = []
      state.error = null
    },
    loadTopicMessages: (state, action: PayloadAction<{ topicId: string; messages: Message[] }>) => {
      const { topicId, messages } = action.payload
      state.messagesByTopic[topicId] = messages
    },
    setStreamMessage: (state, action: PayloadAction<{ topicId: string; message: Message | null }>) => {
      const { topicId, message } = action.payload

      if (!state.streamMessagesByTopic[topicId]) {
        state.streamMessagesByTopic[topicId] = {}
      }

      if (message) {
        state.streamMessagesByTopic[topicId][message.id] = message
      }
    },
    commitStreamMessage: (state, action: PayloadAction<{ topicId: string; messageId: string }>) => {
      const { topicId, messageId } = action.payload
      const streamMessage = state.streamMessagesByTopic[topicId]?.[messageId]

      // 如果没有流消息或不是助手消息，则跳过
      if (!streamMessage || streamMessage.role !== 'assistant') {
        return
      }

      // 确保消息数组存在
      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }

      // 尝试找到现有消息
      const existingMessage = state.messagesByTopic[topicId].find(
        (m) => m.role === 'assistant' && m.id === streamMessage.id
      )

      if (existingMessage) {
        // 更新
        Object.assign(existingMessage, streamMessage)
      } else {
        // 添加新消息
        state.messagesByTopic[topicId].push(streamMessage)
      }

      // 删除流状态
      delete state.streamMessagesByTopic[topicId][messageId]
    },
    clearStreamMessage: (state, action: PayloadAction<{ topicId: string; messageId: string }>) => {
      const { topicId, messageId } = action.payload

      if (state.streamMessagesByTopic[topicId]) {
        delete state.streamMessagesByTopic[topicId][messageId]
      }
    }
  }
})

const handleResponseMessageUpdate = (
  assistant: Assistant,
  message: Message,
  topicId: string,
  dispatch: AppDispatch,
  getState: () => RootState
) => {
  dispatch(setStreamMessage({ topicId, message }))
  if (message.status !== 'pending') {
    // When message is complete, commit to messages and sync with DB
    if (message.status === 'success') {
      autoRenameTopic(assistant, topicId)
    }

    if (message.status !== 'sending') {
      dispatch(commitStreamMessage({ topicId, messageId: message.id }))
      const state = getState()
      const topicMessages = state.messages.messagesByTopic[topicId]
      if (topicMessages) {
        syncMessagesWithDB(topicId, topicMessages)
      }
    }
  }
}

// Helper function to sync messages with database
const syncMessagesWithDB = async (topicId: string, messages: Message[]) => {
  const topic = await db.topics.get(topicId)
  if (topic) {
    await db.topics.update(topicId, { messages })
  } else {
    await db.topics.add({ id: topicId, messages })
  }
}

// Modified sendMessage thunk
export const sendMessage =
  (
    userMessage: Message,
    assistant: Assistant,
    topic: Topic,
    options?: {
      resendAssistantMessage?: Message | Message[]
      isMentionModel?: boolean
      mentions?: Model[]
    }
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      dispatch(setTopicLoading({ topicId: topic.id, loading: true }))

      // Initialize topic messages if not exists
      const initialState = getState()

      if (!initialState.messages.messagesByTopic[topic.id]) {
        dispatch(clearTopicMessages(topic.id))
      }

      // 处理助手消息
      let assistantMessages: Message[] = []
      if (!isEmpty(options?.resendAssistantMessage)) {
        // 直接使用传入的助手消息，进行重置
        const messageToReset = options.resendAssistantMessage
        if (Array.isArray(messageToReset)) {
          assistantMessages = messageToReset.map((m) => {
            const isGroupedMessage = messageToReset.length > 1
            const resetMessage = resetAssistantMessage(m, isGroupedMessage ? m.model : assistant.model)
            // 更新状态
            dispatch(updateMessage({ topicId: topic.id, messageId: m.id, updates: resetMessage }))
            // 使用重置后的消息
            return resetMessage
          })
        } else {
          const { model, id } = messageToReset
          const resetMessage = resetAssistantMessage(messageToReset, model)
          // 更新状态
          dispatch(updateMessage({ topicId: topic.id, messageId: id, updates: resetMessage }))
          // 使用重置后的消息
          assistantMessages.push(resetMessage)
        }
      } else {
        // 为每个被 mention 的模型创建一个助手消息
        if (options?.mentions?.length) {
          assistantMessages = options?.mentions.map((m) => {
            const assistantMessage = getAssistantMessage({ assistant: { ...assistant, model: m }, topic })
            assistantMessage.model = m
            assistantMessage.askId = userMessage.id
            assistantMessage.status = 'sending'
            return assistantMessage
          })
        } else {
          // 创建新的助手消息
          const assistantMessage = getAssistantMessage({ assistant, topic })
          assistantMessage.askId = userMessage.id
          assistantMessage.status = 'sending'
          assistantMessages.push(assistantMessage)
        }

        // 获取当前消息列表
        const currentMessages = getState().messages.messagesByTopic[topic.id]

        // 最后一个具有相同askId的助手消息，在其后插入
        let position: number | undefined
        if (options?.isMentionModel) {
          // 寻找用户提问对应的助手回答消息位置
          const lastAssistantIndex = currentMessages.findLastIndex(
            (m) => m.role === 'assistant' && m.askId === userMessage.id
          )

          // 如果找到了助手消息，在助手消息后插入
          if (lastAssistantIndex !== -1) {
            position = lastAssistantIndex + 1
          } else {
            // 如果找不到助手消息，则在用户消息后插入
            const userMessageIndex = currentMessages.findIndex((m) => m.role === 'user' && m.id === userMessage.id)
            if (userMessageIndex !== -1) {
              position = userMessageIndex + 1
            }
          }
        }

        dispatch(
          appendMessage({
            topicId: topic.id,
            messages: options?.isMentionModel ? assistantMessages : [userMessage, ...assistantMessages],
            position
          })
        )
      }

      for (const assistantMessage of assistantMessages) {
        // for of会收到await 影响,在暂停的时候会因为异步的原因有概率拿不到数据
        dispatch(setStreamMessage({ topicId: topic.id, message: assistantMessage }))
      }

      const queue = getTopicQueue(topic.id)

      for (const assistantMessage of assistantMessages) {
        // Set as stream message instead of adding to messages

        // Sync user message with database
        const state = getState()
        const currentTopicMessages = state.messages.messagesByTopic[topic.id]

        if (currentTopicMessages) {
          await syncMessagesWithDB(topic.id, currentTopicMessages)
        }

        // 保证请求有序，防止请求静态，限制并发数量
        queue.add(async () => {
          try {
            const messages = getState().messages.messagesByTopic[topic.id]
            if (!messages) {
              dispatch(clearTopicMessages(topic.id))
              return
            }

            // Prepare assistant config
            const assistantWithModel = assistantMessage.model
              ? { ...assistant, model: assistantMessage.model }
              : assistant

            if (topic.prompt) {
              assistantWithModel.prompt = assistantWithModel.prompt
                ? `${assistantWithModel.prompt}\n${topic.prompt}`
                : topic.prompt
            }

            // 节流
            const throttledDispatch = throttle(handleResponseMessageUpdate, 100, { trailing: true }) // 100ms的节流时间应足够平衡用户体验和性能
            // 寻找当前正在处理的消息在消息列表中的位置
            // const messageIndex = messages.findIndex((m) => m.id === assistantMessage.id)
            const handleMessages = (): Message[] => {
              // 找到对应的用户消息位置
              const userMessageIndex = messages.findIndex((m) => m.id === assistantMessage.askId)

              if (userMessageIndex !== -1) {
                // 先截取到用户消息为止的所有消息，再进行过滤
                const messagesUpToUser = messages.slice(0, userMessageIndex + 1)
                return messagesUpToUser.filter((m) => !m.status?.includes('ing'))
              }

              // 没有找到消息索引的情况，过滤所有消息
              return messages.filter((m) => !m.status?.includes('ing'))
            }

            await fetchChatCompletion({
              message: { ...assistantMessage },
              messages: handleMessages(),
              assistant: assistantWithModel,
              onResponse: async (msg) => {
                // 允许在回调外维护一个最新的消息状态，每次都更新这个对象，但只通过节流函数分发到Redux
                const updateMessage = { ...msg, status: msg.status || 'pending', content: msg.content || '' }
                // 使用节流函数更新Redux
                throttledDispatch(
                  assistant,
                  {
                    ...assistantMessage,
                    ...updateMessage
                  },
                  topic.id,
                  dispatch,
                  getState
                )
              }
            })
          } catch (error: any) {
            console.error('Error in chat completion:', error)
            dispatch(
              updateMessage({
                topicId: topic.id,
                messageId: assistantMessage.id,
                updates: { status: 'error', error: { message: error.message } }
              })
            )
            dispatch(clearStreamMessage({ topicId: topic.id, messageId: assistantMessage.id }))
            dispatch(setError(error.message))
          }
        })
      }
    } catch (error: any) {
      console.error('Error in sendMessage:', error)
      dispatch(setError(error.message))
      dispatch(setTopicLoading({ topicId: topic.id, loading: false }))
    } finally {
      // 等待所有请求完成,设置loading
      await waitForTopicQueue(topic.id)
      dispatch(setTopicLoading({ topicId: topic.id, loading: false }))
    }
  }

// resendMessage thunk，专门用于重发消息和在助手消息下@新模型
// 本质都是重发助手消息,兼容了两种消息类型,以及@新模型(属于追加助手消息之后重发)
export const resendMessage =
  (message: Message, assistant: Assistant, topic: Topic, isMentionModel = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      // 获取状态
      const state = getState()
      const topicMessages = state.messages.messagesByTopic[topic.id] || []

      // 如果是用户消息，直接重发
      if (message.role === 'user') {
        // 查找此用户消息对应的助手消息
        const assistantMessage = topicMessages.filter((m) => m.role === 'assistant' && m.askId === message.id)

        return dispatch(
          sendMessage(message, assistant, topic, {
            resendAssistantMessage: assistantMessage,
            // 用户可能把助手消息删了,然后重新发送用户消息
            // 如果 isMentionModel 为 false, 则只会发送 add 助手消息
            isMentionModel: isEmpty(assistantMessage),
            mentions: message.mentions
          })
        )
      }

      // 如果是助手消息，找到对应的用户消息
      const userMessage = topicMessages.find((m) => m.id === message.askId && m.role === 'user')
      if (!userMessage) {
        dispatch(
          updateMessage({
            topicId: topic.id,
            messageId: message.id,
            updates: { status: 'error', error: { message: i18n.t('error.user_message_not_found') } }
          })
        )
        console.error(i18n.t('error.user_message_not_found'))
        return dispatch(setError(i18n.t('error.user_message_not_found')))
      }

      if (isMentionModel) {
        // @,追加助手消息
        return dispatch(sendMessage(userMessage, assistant, topic, { isMentionModel }))
      }

      console.log('assistantMessage', message)
      dispatch(
        sendMessage(userMessage, assistant, topic, {
          resendAssistantMessage: message
        })
      )
    } catch (error: any) {
      console.error('Error in resendMessage:', error)
      dispatch(setError(error.message))
    }
  }

// Modified loadTopicMessages thunk
export const loadTopicMessagesThunk = (topic: Topic) => async (dispatch: AppDispatch) => {
  // 设置会话的loading状态
  dispatch(setTopicLoading({ topicId: topic.id, loading: true }))
  dispatch(setCurrentTopic(topic))
  try {
    // 使用 getTopic 获取会话对象
    const topicWithDB = await TopicManager.getTopic(topic.id)
    if (topicWithDB) {
      // 如果数据库中有会话，加载消息，保存会话
      dispatch(loadTopicMessages({ topicId: topic.id, messages: topicWithDB.messages }))
    }
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to load messages'))
  } finally {
    // 清除会话的loading状态
    dispatch(setTopicLoading({ topicId: topic.id, loading: false }))
  }
}

// Modified clearMessages thunk
export const clearTopicMessagesThunk = (topic: Topic) => async (dispatch: AppDispatch) => {
  try {
    // 设置会话的loading状态
    dispatch(setTopicLoading({ topicId: topic.id, loading: true }))

    // Wait for any pending requests to complete
    await waitForTopicQueue(topic.id)

    // Clear the topic's request queue
    clearTopicQueue(topic.id)

    // Clear messages from state and database
    dispatch(clearTopicMessages(topic.id))
    await db.topics.update(topic.id, { messages: [] })

    // Update current topic
    dispatch(setCurrentTopic(topic))
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to clear messages'))
  } finally {
    // 清除会话的loading状态
    dispatch(setTopicLoading({ topicId: topic.id, loading: false }))
  }
}

// 修改的 updateMessages thunk，同时更新缓存
export const updateMessages = (topic: Topic, messages: Message[]) => async (dispatch: AppDispatch) => {
  try {
    // 更新数据库
    await db.topics.update(topic.id, { messages })

    // 更新 Redux store
    dispatch(loadTopicMessages({ topicId: topic.id, messages }))
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to update messages'))
  }
}

// Selectors
export const selectCurrentTopicId = (state: RootState): string | null => {
  const messagesState = state.messages
  return messagesState.currentTopic?.id ?? null
}

export const selectTopicMessages = createSelector(
  [(state: RootState) => state.messages.messagesByTopic, (_, topicId: string) => topicId],
  (messagesByTopic, topicId) => (topicId ? (messagesByTopic[topicId] ?? []) : [])
)

// 获取特定话题的loading状态
export const selectTopicLoading = (state: RootState, topicId?: string): boolean => {
  const messagesState = state.messages as MessagesState
  const currentTopicId = topicId || messagesState.currentTopic?.id || ''
  return currentTopicId ? (messagesState.loadingByTopic[currentTopicId] ?? false) : false
}

export const selectDisplayCount = (state: RootState): number => {
  const messagesState = state.messages as MessagesState
  return messagesState?.displayCount || 20
}

export const selectError = (state: RootState): string | null => {
  const messagesState = state.messages as MessagesState
  return messagesState?.error || null
}

export const selectStreamMessage = (state: RootState, topicId: string, messageId: string): Message | null => {
  const messagesState = state.messages as MessagesState
  return messagesState.streamMessagesByTopic[topicId]?.[messageId] || null
}

export const {
  setTopicLoading,
  setError,
  setDisplayCount,
  addMessage,
  updateMessage,
  setCurrentTopic,
  clearTopicMessages,
  loadTopicMessages,
  setStreamMessage,
  commitStreamMessage,
  clearStreamMessage,
  appendMessage
} = messagesSlice.actions

export default messagesSlice.reducer
