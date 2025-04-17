import { createSlice, PayloadAction } from '@reduxjs/toolkit'
// Separate type-only imports from value imports
import type { Message } from '@renderer/types/newMessageTypes'
import {
  MessageBlockStatus // Import as value
} from '@renderer/types/newMessageTypes'

// Define loading states
// type LoadingState = 'idle' | 'loading' | 'error' // REMOVED as loadingByTopic is now boolean

// Modify state to track loading state and error per topic
export interface MessagesState {
  messagesByTopic: Record<string, Message[]>
  currentTopicId: string | null // Store only the ID
  loadingByTopic: Record<string, boolean> // Changed back to boolean
  displayCount: number
}

const initialState: MessagesState = {
  messagesByTopic: {},
  currentTopicId: null,
  loadingByTopic: {}, // Initialize as empty object
  displayCount: 20
}

// Payload for receiving messages (used by loadTopicMessagesThunk)
interface MessagesReceivedPayload {
  topicId: string
  messages: Message[]
}

// Payload for setting topic loading state
interface SetTopicLoadingPayload {
  topicId: string
  loading: boolean // Changed back to boolean
}

// Payload for upserting a block reference
interface UpsertBlockReferencePayload {
  messageId: string
  blockId: string
  status?: MessageBlockStatus
}

const messagesSlice = createSlice({
  name: 'newMessages', // Renamed slice
  initialState,
  reducers: {
    setCurrentTopicId(state, action: PayloadAction<string | null>) {
      state.currentTopicId = action.payload
      if (action.payload && !(action.payload in state.messagesByTopic)) {
        // Initialize topic state if not present
        state.messagesByTopic[action.payload] = []
        state.loadingByTopic[action.payload] = false // Initialize loading to false
      }
    },
    setTopicLoading(state, action: PayloadAction<SetTopicLoadingPayload>) {
      const { topicId, loading } = action.payload
      state.loadingByTopic[topicId] = loading
    },
    setDisplayCount(state, action: PayloadAction<number>) {
      state.displayCount = action.payload
    },
    // Action to handle messages received from DB/Thunk
    messagesReceived(state, action: PayloadAction<MessagesReceivedPayload>) {
      const { topicId, messages } = action.payload
      // Replace existing messages for the topic
      state.messagesByTopic[topicId] = messages.map((m) => ({ ...m, blocks: m.blocks?.map(String) || [] }))
      state.loadingByTopic[topicId] = false // Set loading to false after receiving
    },
    addMessage(state, action: PayloadAction<{ topicId: string; message: Message }>) {
      const { topicId, message } = action.payload
      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }
      // Ensure blocks is an array of strings
      const messageToAdd = { ...message, blocks: message.blocks?.map(String) || [] }
      state.messagesByTopic[topicId].push(messageToAdd)
      // Initialize loading state if topic is new
      if (!(topicId in state.loadingByTopic)) {
        state.loadingByTopic[topicId] = false
      }
    },
    updateMessage(
      state,
      action: PayloadAction<{
        topicId: string
        messageId: string
        updates: Partial<Message> & { blockInstruction?: { id: string; position?: number } }
      }>
    ) {
      const { topicId, messageId, updates } = action.payload
      const topicMessages = state.messagesByTopic[topicId]
      if (topicMessages) {
        const messageIndex = topicMessages.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          const messageToUpdate = topicMessages[messageIndex]

          // Separate blockInstruction from other updates
          const { blockInstruction, ...otherUpdates } = updates

          // Apply other updates first
          // Ensure incoming blocks update (if any) is string[]
          if (otherUpdates.blocks) {
            otherUpdates.blocks = otherUpdates.blocks.map(String)
          }
          Object.assign(messageToUpdate, otherUpdates)

          // Handle adding a block if instruction exists
          if (blockInstruction) {
            const { id: blockIdToAdd, position } = blockInstruction

            if (!messageToUpdate.blocks) {
              messageToUpdate.blocks = []
            }

            // Ensure we don't add duplicates if accidentally called multiple times
            if (!messageToUpdate.blocks.includes(blockIdToAdd)) {
              if (typeof position === 'number' && position >= 0 && position <= messageToUpdate.blocks.length) {
                // Insert at specific position
                messageToUpdate.blocks.splice(position, 0, blockIdToAdd)
              } else {
                // Push to the end (default or invalid position)
                messageToUpdate.blocks.push(blockIdToAdd)
              }
            }
          }
        }
      }
    },
    clearTopicMessages(state, action: PayloadAction<string>) {
      const topicId = action.payload
      if (state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }
      state.loadingByTopic[topicId] = false // Reset loading state
    },
    upsertBlockReference(state, action: PayloadAction<UpsertBlockReferencePayload>) {
      const { messageId, blockId, status } = action.payload

      let targetTopicId: string | null = null
      for (const topicId in state.messagesByTopic) {
        if (state.messagesByTopic[topicId].some((msg) => msg.id === messageId)) {
          targetTopicId = topicId
          break
        }
      }

      if (!targetTopicId) {
        console.error(`[upsertBlockReference] Message ${messageId} not found in any topic.`)
        return
      }

      const messageIndex = state.messagesByTopic[targetTopicId].findIndex((msg) => msg.id === messageId)
      if (messageIndex === -1) {
        console.error(`[upsertBlockReference] Message ${messageId} not found in topic ${targetTopicId}.`)
        return
      }

      const message = state.messagesByTopic[targetTopicId][messageIndex]

      // Update Message Status based on block status
      if (status) {
        if (
          status === MessageBlockStatus.PROCESSING &&
          message.status !== 'processing' &&
          message.status !== 'success' &&
          message.status !== 'error'
        ) {
          message.status = 'processing'
        } else if (status === MessageBlockStatus.ERROR) {
          message.status = 'error'
        } else if (status === MessageBlockStatus.SUCCESS && message.status === 'processing') {
          // TODO: Check if ALL blocks are success before setting message to success? Might need selector.
          // For now, tentatively set to success if a block succeeds while processing.
          // This might need refinement based on desired UX.
          // message.status = 'success';
        }
      }

      // Add Block ID if it doesn't exist
      if (!message.blocks) {
        message.blocks = []
      }
      const blockIds = message.blocks.map(String)
      if (!blockIds.includes(blockId)) {
        message.blocks.push(blockId)
      }
    }
  }
})

// Export the actions for use in thunks, etc.
export const newMessagesActions = messagesSlice.actions

export default messagesSlice.reducer
