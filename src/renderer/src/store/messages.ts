import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import db from '@renderer/databases'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { AppDispatch, RootState } from '@renderer/store'
import { Assistant, FileType, Message, Model, Topic } from '@renderer/types'
import { clearTopicQueue, getTopicQueue, waitForTopicQueue } from '@renderer/utils/queue'

// Helper functions for converting between store and DB formats
/* Commented out as currently unused
const convertToStoreFormat = (messages: Message[]): TopicMessages => ({
  userMessages: messages.filter((msg) => msg.role === 'user'),
  assistantMessages: messages.filter((msg) => msg.role === 'assistant')
})
*/

const convertToDBFormat = (topicMessages: TopicMessages): Message[] => {
  return [...topicMessages.userMessages, ...topicMessages.assistantMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
}

export interface TopicMessages {
  userMessages: Message[]
  assistantMessages: Message[]
}

export interface MessagesState {
  messagesByTopic: Record<string, TopicMessages>
  currentTopic: string
  loading: boolean
  displayCount: number
  error: string | null
}

const initialState: MessagesState = {
  messagesByTopic: {},
  currentTopic: '',
  loading: false,
  displayCount: 20,
  error: null
}

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
    addMessage: (state, action: PayloadAction<{ topicId: string; message: Message }>) => {
      const { topicId, message } = action.payload
      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = {
          userMessages: [],
          assistantMessages: []
        }
      }

      if (message.role === 'user') {
        state.messagesByTopic[topicId].userMessages.push(message)
      } else {
        state.messagesByTopic[topicId].assistantMessages.push(message)
      }
    },
    updateMessage: (
      state,
      action: PayloadAction<{ topicId: string; messageId: string; updates: Partial<Message> }>
    ) => {
      const { topicId, messageId, updates } = action.payload
      const topicMessages = state.messagesByTopic[topicId]
      if (topicMessages) {
        const isUserMessage = topicMessages.userMessages.some((msg) => msg.id === messageId)
        const messages = isUserMessage ? topicMessages.userMessages : topicMessages.assistantMessages
        const messageIndex = messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          messages[messageIndex] = {
            ...messages[messageIndex],
            ...updates
          }
        }
      }
    },
    setCurrentTopic: (state, action: PayloadAction<string>) => {
      state.currentTopic = action.payload
    },
    clearTopicMessages: (state, action: PayloadAction<string>) => {
      const topicId = action.payload
      state.messagesByTopic[topicId] = {
        userMessages: [],
        assistantMessages: []
      }
      state.error = null
    },
    loadTopicMessages: (state, action: PayloadAction<{ topicId: string; messages: Message[] }>) => {
      const { topicId, messages } = action.payload
      state.messagesByTopic[topicId] = {
        userMessages: messages.filter((msg) => msg.role === 'user'),
        assistantMessages: messages.filter((msg) => msg.role === 'assistant')
      }
    }
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
  loadTopicMessages
} = messagesSlice.actions

// Helper function to get all messages for a topic in order
/* Commented out as currently unused
const getTopicMessages = (state: MessagesState, topicId: string): Message[] => {
  const topicMessages = state.messagesByTopic[topicId]
  if (!topicMessages) return []

  const messages = [...topicMessages.userMessages, ...topicMessages.assistantMessages]
  return messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}
*/

// Helper function to sync messages with database
const syncMessagesWithDB = async (topicId: string, topicMessages: TopicMessages) => {
  const dbMessages = convertToDBFormat(topicMessages)
  await db.topics.update(topicId, { messages: dbMessages })
}

// Modified sendMessage thunk
export const sendMessage =
  (
    content: string,
    assistant: Assistant,
    topic: Topic,
    options?: { files?: FileType[]; knowledgeBaseIds?: string[]; mentionModels?: Model[] }
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      dispatch(setLoading(true))

      // Initialize topic messages if not exists
      const initialState = getState()
      if (!initialState.messages.messagesByTopic[topic.id]) {
        dispatch(clearTopicMessages(topic.id))
      }

      // Create user message using existing helper
      const userMessage = getUserMessage({
        assistant,
        topic,
        type: 'text',
        content
      })

      // Add additional properties if they exist
      if (options?.files) {
        userMessage.files = options.files
      }
      if (options?.knowledgeBaseIds) {
        userMessage.knowledgeBaseIds = options.knowledgeBaseIds
      }
      if (options?.mentionModels) {
        userMessage.mentions = options.mentionModels
      }

      dispatch(addMessage({ topicId: topic.id, message: userMessage }))

      // Create assistant message using existing helper
      const assistantMessage = getAssistantMessage({ assistant, topic })
      assistantMessage.askId = userMessage.id
      assistantMessage.status = 'sending'
      dispatch(addMessage({ topicId: topic.id, message: assistantMessage }))

      // Sync with database
      const state = getState()
      const currentTopicMessages = state.messages.messagesByTopic[topic.id]
      if (currentTopicMessages) {
        await syncMessagesWithDB(topic.id, currentTopicMessages)
      }

      // Use topic queue to handle request
      const queue = getTopicQueue(topic.id)
      await queue.add(async () => {
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
              // Create a new message object for the update
              const updatedMsg = {
                ...msg,
                status: msg.status || 'pending',
                content: msg.content || ''
              }

              // Update message in store
              dispatch(
                updateMessage({
                  topicId: topic.id,
                  messageId: assistantMessage.id,
                  updates: updatedMsg
                })
              )

              // Sync with database if message is complete
              if (updatedMsg.status !== 'pending') {
                const state = getState()
                const topicMessages = state.messages.messagesByTopic[topic.id]
                if (topicMessages) {
                  await syncMessagesWithDB(topic.id, topicMessages)
                }
              }
            }
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          // Update message with error state
          dispatch(
            updateMessage({
              topicId: topic.id,
              messageId: assistantMessage.id,
              updates: {
                status: 'error',
                error: { message: errorMessage }
              }
            })
          )
          dispatch(setError(errorMessage))
        }
      })

      return { userMessage, assistantMessage }
    } catch (error) {
      dispatch(setError(error instanceof Error ? error.message : 'Failed to send message'))
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
    if (!topicMessages) return []

    return [...topicMessages.userMessages, ...topicMessages.assistantMessages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
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

export default messagesSlice.reducer
