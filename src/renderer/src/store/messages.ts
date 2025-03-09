import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import db from '@renderer/databases'
import { TopicManager } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getAssistantMessage, getUserMessage, resetAssistantMessage } from '@renderer/services/MessagesService'
import type { AppDispatch, RootState } from '@renderer/store'
import type { Assistant, FileType, MCPServer, Message, Model, Topic } from '@renderer/types'
import { clearTopicQueue, getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'
import { throttle } from 'lodash'

const convertToDBFormat = (messages: Message[]): Message[] => {
  return [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export interface MessagesState {
  messagesByTopic: Record<string, Message[]>
  streamMessagesByTopic: Record<string, Record<string, Message | null>>
  currentTopic: string
  loading: boolean
  displayCount: number
  error: string | null
}

const initialState: MessagesState = {
  messagesByTopic: {},
  streamMessagesByTopic: {},
  currentTopic: '',
  loading: false,
  displayCount: 20,
  error: null
}

export const initializeMessagesState = createAsyncThunk('messages/initialize', async () => {
  // Get all topics from database
  const topics = await TopicManager.getAllTopics()
  const messagesByTopic: Record<string, Message[]> = {}

  // Group topics by assistantId and update messagesByTopic
  for (const topic of topics) {
    if (topic.messages && topic.messages.length > 0) {
      messagesByTopic[topic.id] = topic.messages.map((msg) => ({ ...msg }))
    }
  }

  return messagesByTopic
})

const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
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
        const messageIndex = topicMessages.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          topicMessages[messageIndex] = { ...topicMessages[messageIndex], ...updates }
        }
      }
    },
    setCurrentTopic: (state, action: PayloadAction<string>) => {
      state.currentTopic = action.payload
    },
    clearTopicMessages: (state, action: PayloadAction<string>) => {
      const topicId = action.payload
      state.messagesByTopic[topicId] = []
      state.error = null
    },
    loadTopicMessages: (state, action: PayloadAction<{ topicId: string; messages: Message[] }>) => {
      const { topicId, messages } = action.payload
      state.messagesByTopic[topicId] = messages.map((msg) => ({ ...msg }))
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

      // 如果没有流消息，则不执行任何操作
      if (!streamMessage || streamMessage.role !== 'assistant') {
        return
      }

      // 查找是否已经存在具有相同Id的助手消息
      const existingMessageIndex =
        state.messagesByTopic[topicId]?.findIndex((m) => m.role === 'assistant' && m.id === streamMessage.id) ?? -1

      if (existingMessageIndex !== -1) {
        // 替换已有的消息
        state.messagesByTopic[topicId][existingMessageIndex] = streamMessage
      } else if (state.messagesByTopic[topicId]) {
        // 如果不存在但存在topicMessages，则添加新消息
        state.messagesByTopic[topicId].push(streamMessage)
      }

      // 只删除这个特定消息的流状态
      delete state.streamMessagesByTopic[topicId][messageId]
    },
    clearStreamMessage: (state, action: PayloadAction<{ topicId: string; messageId: string }>) => {
      const { topicId, messageId } = action.payload
      if (state.streamMessagesByTopic[topicId]) {
        delete state.streamMessagesByTopic[topicId][messageId]
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeMessagesState.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(initializeMessagesState.fulfilled, (state, action) => {
        console.log('initializeMessagesState.fulfilled', action.payload)
        state.loading = false
        state.messagesByTopic = action.payload
      })
      .addCase(initializeMessagesState.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to load messages'
      })
  }
})

export const {
  setLoading,
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

const handleResponseMessageUpdate = (message, topicId, dispatch, getState) => {
  dispatch(setStreamMessage({ topicId, message }))

  // When message is complete, commit to messages and sync with DB
  if (message.status !== 'pending') {
    if (message.status === 'success') {
      EventEmitter.emit(EVENT_NAMES.AI_AUTO_RENAME)
    }

    dispatch(commitStreamMessage({ topicId, messageId: message.id }))

    const state = getState()
    const topicMessages = state.messages.messagesByTopic[topicId]
    if (topicMessages) {
      syncMessagesWithDB(topicId, topicMessages)
    }
  }
}

// Helper function to sync messages with database
const syncMessagesWithDB = async (topicId: string, messages: Message[]) => {
  const dbMessages = convertToDBFormat(messages)
  await db.topics.put({
    id: topicId,
    messages: dbMessages
  })
}

// Modified sendMessage thunk
export const sendMessage =
  (
    content: string,
    assistant: Assistant,
    topic: Topic,
    options?: {
      files?: FileType[]
      knowledgeBaseIds?: string[]
      mentionModels?: Model[]
      resendUserMessage?: Message
      resendAssistantMessage?: Message
      enabledMCPs?: MCPServer[]
    }
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      dispatch(setLoading(true))

      // Initialize topic messages if not exists
      const initialState = getState()
      if (!initialState.messages.messagesByTopic[topic.id]) {
        dispatch(clearTopicMessages(topic.id))
      }

      // 判断是否重发消息
      const isResend = !!options?.resendUserMessage

      // 使用用户消息
      let userMessage: Message
      if (isResend) {
        userMessage = options.resendUserMessage!
      } else {
        // 创建新的用户消息
        userMessage = getUserMessage({ assistant, topic, type: 'text', content })

        if (options?.files) {
          userMessage.files = options.files
        }

        if (options?.knowledgeBaseIds) {
          userMessage.knowledgeBaseIds = options.knowledgeBaseIds
        }

        if (options?.mentionModels) {
          userMessage.mentions = options.mentionModels
        }

        if (options?.enabledMCPs) {
          userMessage.enabledMCPs = options.enabledMCPs
        }
      }

      // 如果不是重发，才添加新的用户消息
      if (!isResend) {
        dispatch(addMessage({ topicId: topic.id, messages: userMessage }))
      }

      EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE)

      // 处理助手消息
      // let assistantMessage: Message
      let assistantMessages: Message[] = []

      // 使用助手消息
      if (isResend && options.resendAssistantMessage) {
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
        // 为每个被 mention 的模型创建一个助手消息
        if (options?.mentionModels?.length) {
          assistantMessages = options.mentionModels.map((m) => {
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
      }

      // Use topic queue to handle request
      const queue = getTopicQueue(topic.id)

      // let assistantMessage: Message | undefined
      if (!isResend) {
        dispatch(addMessage({ topicId: topic.id, messages: assistantMessages }))
      }

      for (const assistantMessage of assistantMessages) {
        // console.log('assistantMessage', assistantMessage)

        // Set as stream message instead of adding to messages
        dispatch(setStreamMessage({ topicId: topic.id, message: assistantMessage }))

        // Sync user message with database
        const state = getState()
        const currentTopicMessages = state.messages.messagesByTopic[topic.id]

        if (currentTopicMessages) {
          await syncMessagesWithDB(topic.id, currentTopicMessages)
        }

        queue.add(async () => {
          try {
            const state = getState()
            const topicMessages = state.messages.messagesByTopic[topic.id]
            if (!topicMessages) {
              dispatch(clearTopicMessages(topic.id))
              return
            }

            const messages = convertToDBFormat(topicMessages)

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

            await fetchChatCompletion({
              message: { ...assistantMessage },
              messages: messages
                .filter((m) => !m.status?.includes('ing'))
                .slice(
                  0,
                  messages.findIndex((m) => m.id === assistantMessage.id)
                ),
              assistant: assistantWithModel,
              onResponse: async (msg) => {
                // 允许在回调外维护一个最新的消息状态，每次都更新这个对象，但只通过节流函数分发到Redux
                const updatedMsg = { ...msg, status: msg.status || 'pending', content: msg.content || '' }
                // 创建节流函数，限制Redux更新频率
                // 使用节流函数更新Redux
                throttledDispatch({ ...assistantMessage, ...updatedMsg }, topic.id, dispatch, getState)
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
    } finally {
      dispatch(setLoading(false))
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

        dispatch(
          sendMessage(message.content, assistant, topic, {
            resendUserMessage: message,
            resendAssistantMessage: assistantMessage
          })
        )
      }

      // 如果是助手消息，找到对应的用户消息
      const userMessage = topicMessages.find((m) => m.id === message.askId && m.role === 'user')

      if (!userMessage) {
        console.error('Cannot find original user message to resend')
        dispatch(setError('Cannot find original user message to resend'))
        return
      }

      if (isMentionModel) {
        // @
        return dispatch(
          sendMessage(userMessage.content, assistant, topic, {
            resendUserMessage: userMessage
          })
        )
      }

      dispatch(
        sendMessage(userMessage.content, assistant, topic, {
          resendUserMessage: userMessage,
          resendAssistantMessage: message
        })
      )
    } catch (error: any) {
      console.error('Error in resendMessage:', error)
      dispatch(setError(error.message))
    } finally {
      dispatch(setLoading(false))
    }
  }

// Modified loadTopicMessages thunk
export const loadTopicMessagesThunk = (topicId: string) => async (dispatch: AppDispatch) => {
  try {
    dispatch(setLoading(true))
    const topic = await db.topics.get(topicId)
    const messages = topic?.messages || []

    // Initialize topic messages
    dispatch(clearTopicMessages(topicId))
    dispatch(loadTopicMessages({ topicId, messages }))
    dispatch(setCurrentTopic(topicId))
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to load messages'))
  } finally {
    dispatch(setLoading(false))
  }
}

// Modified clearMessages thunk
export const clearTopicMessagesThunk = (topic: Topic) => async (dispatch: AppDispatch) => {
  try {
    dispatch(setLoading(true))

    // Wait for any pending requests to complete
    await waitForTopicQueue(topic.id)

    // Clear the topic's request queue
    clearTopicQueue(topic.id)

    // Clear messages from state and database
    dispatch(clearTopicMessages(topic.id))
    await db.topics.update(topic.id, { messages: [] })

    // Update current topic
    dispatch(setCurrentTopic(topic.id))
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to clear messages'))
  } finally {
    dispatch(setLoading(false))
  }
}

// Modified updateMessages thunk
export const updateMessages = (topic: Topic, messages: Message[]) => async (dispatch: AppDispatch) => {
  try {
    dispatch(setLoading(true))
    await db.topics.update(topic.id, { messages })
    dispatch(loadTopicMessages({ topicId: topic.id, messages }))
  } catch (error) {
    dispatch(setError(error instanceof Error ? error.message : 'Failed to update messages'))
  } finally {
    dispatch(setLoading(false))
  }
}

// Selectors
export const selectTopicMessages = createSelector(
  [(state: RootState) => state.messages, (_, topicId: string) => topicId],
  (messagesState, topicId) => {
    const topicMessages = messagesState.messagesByTopic[topicId]

    if (!topicMessages) {
      return []
    }

    return [...topicMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }
)

export const selectCurrentTopicId = (state: RootState): string => {
  const messagesState = state.messages as MessagesState
  return messagesState?.currentTopic || ''
}

export const selectLoading = (state: RootState): boolean => {
  const messagesState = state.messages as MessagesState
  return messagesState?.loading || false
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

export default messagesSlice.reducer
