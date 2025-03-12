import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import db from '@renderer/databases'
import { autoRenameTopic, TopicManager } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getAssistantMessage, resetAssistantMessage } from '@renderer/services/MessagesService'
import type { AppDispatch, RootState } from '@renderer/store'
import type { Assistant, Message, Topic } from '@renderer/types'
import { clearTopicQueue, getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'
import { throttle } from 'lodash'

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

// const MAX_RECENT_TOPICS = 10

// // 只初始化最近的会话消息
// export const initializeMessagesState = createAsyncThunk('messages/initialize', async () => {
//   try {
//     // 获取所有会话的基本信息
//     const recentTopics = await TopicManager.getTopicLimit(MAX_RECENT_TOPICS)
//     console.log('recentTopics', recentTopics)
//     const messagesByTopic: Record<string, Message[]> = {}

//     // 只加载最近会话的消息
//     for (const topic of recentTopics) {
//       if (topic.messages && topic.messages.length > 0) {
//         const messages = topic.messages.map((msg) => ({ ...msg }))
//         messagesByTopic[topic.id] = messages
//       }
//     }

//     return messagesByTopic
//   } catch (error) {
//     console.error('Failed to initialize recent messages:', error)
//     return {}
//   }
// })

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
  // extraReducers: (builder) => {
  //   builder
  //     .addCase(initializeMessagesState.pending, (state) => {
  //       state.error = null
  //     })
  //     .addCase(initializeMessagesState.fulfilled, (state, action) => {
  //       console.log('initializeMessagesState.fulfilled', action.payload)
  //       state.messagesByTopic = action.payload
  //     })
  //     .addCase(initializeMessagesState.rejected, (state, action) => {
  //       state.error = action.error.message || 'Failed to load messages'
  //     })
  // }
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
    await db.topics.update(topicId, {
      messages
    })
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
      resendAssistantMessage?: Message
      isMentionModel?: boolean
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

      EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE)

      // 处理助手消息
      let assistantMessages: Message[] = []
      if (options?.resendAssistantMessage) {
        // 直接使用传入的助手消息，进行重置
        const messageToReset = options.resendAssistantMessage
        const { model, id } = messageToReset
        const resetMessage = resetAssistantMessage(messageToReset, model)
        // 更新状态
        dispatch(updateMessage({ topicId: topic.id, messageId: id, updates: resetMessage }))
        // 使用重置后的消息
        assistantMessages.push(resetMessage)
      } else {
        // 不是重发情况
        if (userMessage.mentions?.length) {
          // 为每个被 mention 的模型创建一个助手消息
          assistantMessages = userMessage.mentions.map((m) => {
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
        dispatch(
          addMessage({
            topicId: topic.id,
            messages: !options?.isMentionModel ? [userMessage, ...assistantMessages] : assistantMessages
          })
        )
      }

      const queue = getTopicQueue(topic.id)
      for (const assistantMessage of assistantMessages) {
        // Set as stream message instead of adding to messages
        dispatch(setStreamMessage({ topicId: topic.id, message: assistantMessage }))

        // Sync user message with database
        const state = getState()
        const currentTopicMessages = state.messages.messagesByTopic[topic.id]

        if (currentTopicMessages) {
          await syncMessagesWithDB(topic.id, currentTopicMessages)
        }
        // 保证请求有序，防止请求静态，限制并发数量
        await queue.add(async () => {
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

            const messageIndex = messages.findIndex((m) => m.id === assistantMessage.id)
            await fetchChatCompletion({
              message: { ...assistantMessage },
              messages: messages
                .filter((m) => !m.status?.includes('ing'))
                .slice(0, messageIndex !== -1 ? messageIndex : undefined),
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
      // 等待所有请求完成,设置loading
      await queue.onIdle()
      dispatch(setTopicLoading({ topicId: topic.id, loading: false }))
    } catch (error: any) {
      console.error('Error in sendMessage:', error)
      dispatch(setError(error.message))
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
        const assistantMessage = topicMessages.find((m) => m.role === 'assistant' && m.askId === message.id)

        return dispatch(
          sendMessage(message, assistant, topic, {
            resendAssistantMessage: assistantMessage
          })
        )
      }

      // 如果是助手消息，找到对应的用户消息
      const userMessage = topicMessages.find((m) => m.id === message.askId && m.role === 'user')
      if (!userMessage) {
        console.error('Cannot find original user message to resend')
        return dispatch(setError('Cannot find original user message to resend'))
      }

      if (isMentionModel) {
        // @,追加助手消息
        return dispatch(sendMessage(userMessage, assistant, topic, { isMentionModel }))
      }

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
  clearStreamMessage
} = messagesSlice.actions

export default messagesSlice.reducer
