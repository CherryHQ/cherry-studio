import { loggerService } from '@logger'
import { createEntityAdapter, createSlice, EntityState, PayloadAction } from '@reduxjs/toolkit'
// Separate type-only imports from value imports
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'

const logger = loggerService.withContext('newMessage')

// 1. Create the Adapter
const messagesAdapter = createEntityAdapter<Message>()

// 2. Define the State Interface
export interface MessagesState extends EntityState<Message, string> {
  messageIdsByTopic: Record<string, string[]> // Map: topicId -> ordered message IDs
  currentTopicId: string | null
  loadingByTopic: Record<string, boolean>
  fulfilledByTopic: Record<string, boolean>
  displayCount: number
}

// 3. Define the Initial State
const initialState: MessagesState = messagesAdapter.getInitialState({
  messageIdsByTopic: {},
  currentTopicId: null,
  loadingByTopic: {},
  fulfilledByTopic: {},
  displayCount: 20
})

// Payload for receiving messages (used by loadTopicMessagesThunk)
interface MessagesReceivedPayload {
  topicId: string
  messages: Message[]
}

// Payload for setting topic loading state
interface SetTopicLoadingPayload {
  topicId: string
  loading: boolean
}

// Payload for setting topic loading state
interface SetTopicFulfilledPayload {
  topicId: string
  fulfilled: boolean
}

// Payload for upserting a block reference
interface UpsertBlockReferencePayload {
  messageId: string
  blockId: string
  status?: MessageBlockStatus
}

// Payload for removing a single message
interface RemoveMessagePayload {
  topicId: string
  messageId: string
}

// Payload for removing messages by askId
interface RemoveMessagesByAskIdPayload {
  topicId: string
  askId: string
}

// Payload for removing multiple messages by ID
interface RemoveMessagesPayload {
  topicId: string
  messageIds: string[]
}

// Payload for inserting a message at a specific index
interface InsertMessageAtIndexPayload {
  topicId: string
  message: Message
  index: number
}

// 4. Create the Slice with Refactored Reducers
export const messagesSlice = createSlice({
  name: 'newMessages',
  initialState,
  reducers: {
    setCurrentTopicId(state, action: PayloadAction<string | null>) {
      state.currentTopicId = action.payload
      if (action.payload && !(action.payload in state.messageIdsByTopic)) {
        state.messageIdsByTopic[action.payload] = []
        state.loadingByTopic[action.payload] = false
      }
    },
    setTopicLoading(state, action: PayloadAction<SetTopicLoadingPayload>) {
      const { topicId, loading } = action.payload
      state.loadingByTopic[topicId] = loading
    },
    setTopicFulfilled(state, action: PayloadAction<SetTopicFulfilledPayload>) {
      const { topicId, fulfilled } = action.payload
      state.fulfilledByTopic[topicId] = fulfilled
    },
    setDisplayCount(state, action: PayloadAction<number>) {
      state.displayCount = action.payload
    },
    messagesReceived(state, action: PayloadAction<MessagesReceivedPayload>) {
      const { topicId, messages } = action.payload
      messagesAdapter.upsertMany(state, messages)
      state.messageIdsByTopic[topicId] = messages.map((m) => m.id)
      state.currentTopicId = topicId
    },
    addMessage(state, action: PayloadAction<{ topicId: string; message: Message }>) {
      const { topicId, message } = action.payload
      messagesAdapter.addOne(state, message)
      if (!state.messageIdsByTopic[topicId]) {
        state.messageIdsByTopic[topicId] = []
      }
      state.messageIdsByTopic[topicId].push(message.id)
      if (!(topicId in state.loadingByTopic)) {
        state.loadingByTopic[topicId] = false
      }
      if (!(topicId in state.fulfilledByTopic)) {
        state.fulfilledByTopic[topicId] = false
      }
    },
    insertMessageAtIndex(state, action: PayloadAction<InsertMessageAtIndexPayload>) {
      const { topicId, message, index } = action.payload
      messagesAdapter.addOne(state, message) // Add message to entities
      if (!state.messageIdsByTopic[topicId]) {
        state.messageIdsByTopic[topicId] = []
      }
      // Ensure index is within bounds
      const safeIndex = Math.max(0, Math.min(index, state.messageIdsByTopic[topicId].length))
      state.messageIdsByTopic[topicId].splice(safeIndex, 0, message.id) // Insert ID at specified index

      if (!(topicId in state.loadingByTopic)) {
        state.loadingByTopic[topicId] = false
      }
      if (!(topicId in state.fulfilledByTopic)) {
        state.fulfilledByTopic[topicId] = false
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
      const { messageId, updates } = action.payload
      const { blockInstruction, ...otherUpdates } = updates

      if (blockInstruction) {
        const messageToUpdate = state.entities[messageId]
        if (messageToUpdate) {
          const { id: blockIdToAdd, position } = blockInstruction
          const currentBlocks = [...(messageToUpdate.blocks || [])]
          if (!currentBlocks.includes(blockIdToAdd)) {
            if (typeof position === 'number' && position >= 0 && position <= currentBlocks.length) {
              currentBlocks.splice(position, 0, blockIdToAdd)
            } else {
              currentBlocks.push(blockIdToAdd)
            }
            messagesAdapter.updateOne(state, { id: messageId, changes: { ...otherUpdates, blocks: currentBlocks } })
          } else {
            if (Object.keys(otherUpdates).length > 0) {
              messagesAdapter.updateOne(state, { id: messageId, changes: otherUpdates })
            }
          }
        } else {
          logger.warn(`[updateMessage] Message ${messageId} not found in entities.`)
        }
      } else {
        messagesAdapter.updateOne(state, { id: messageId, changes: otherUpdates })
      }
    },
    clearTopicMessages(state, action: PayloadAction<string>) {
      const topicId = action.payload
      const idsToRemove = state.messageIdsByTopic[topicId] || []
      if (idsToRemove.length > 0) {
        messagesAdapter.removeMany(state, idsToRemove)
      }
      delete state.messageIdsByTopic[topicId]
      state.loadingByTopic[topicId] = false
      state.fulfilledByTopic[topicId] = false
    },
    removeMessage(state, action: PayloadAction<RemoveMessagePayload>) {
      const { topicId, messageId } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId]
      if (currentTopicIds) {
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => id !== messageId)
      }
      messagesAdapter.removeOne(state, messageId)
    },
    removeMessagesByAskId(state, action: PayloadAction<RemoveMessagesByAskIdPayload>) {
      const { topicId, askId } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId] || []
      const idsToRemove: string[] = []

      currentTopicIds.forEach((id) => {
        const message = state.entities[id]
        if (message && message.askId === askId) {
          idsToRemove.push(id)
        }
      })

      if (idsToRemove.length > 0) {
        messagesAdapter.removeMany(state, idsToRemove)
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => !idsToRemove.includes(id))
      }
    },
    removeMessages(state, action: PayloadAction<RemoveMessagesPayload>) {
      const { topicId, messageIds } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId]
      const idsToRemoveSet = new Set(messageIds)
      if (currentTopicIds) {
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => !idsToRemoveSet.has(id))
      }
      messagesAdapter.removeMany(state, messageIds)
    },
    upsertBlockReference(state, action: PayloadAction<UpsertBlockReferencePayload>) {
      const { messageId, blockId, status } = action.payload

      const messageToUpdate = state.entities[messageId]
      if (!messageToUpdate) {
        logger.error(`[upsertBlockReference] Message ${messageId} not found.`)
        return
      }

      const changes: Partial<Message> = {}

      // Update Block ID
      const currentBlocks = messageToUpdate.blocks || []
      if (!currentBlocks.includes(blockId)) {
        changes.blocks = [...currentBlocks, blockId]
      }

      // Update Message Status based on Block Status
      if (status) {
        if (
          (status === MessageBlockStatus.PROCESSING || status === MessageBlockStatus.STREAMING) &&
          messageToUpdate.status !== AssistantMessageStatus.PROCESSING &&
          messageToUpdate.status !== AssistantMessageStatus.SUCCESS &&
          messageToUpdate.status !== AssistantMessageStatus.ERROR
        ) {
          changes.status = AssistantMessageStatus.PROCESSING
        } else if (status === MessageBlockStatus.ERROR) {
          changes.status = AssistantMessageStatus.ERROR
        } else if (
          status === MessageBlockStatus.SUCCESS &&
          messageToUpdate.status === AssistantMessageStatus.PROCESSING
        ) {
          // Tentative success - may need refinement
          // changes.status = AssistantMessageStatus.SUCCESS
        }
      }

      // Apply updates if any changes were made
      if (Object.keys(changes).length > 0) {
        messagesAdapter.updateOne(state, { id: messageId, changes })
      }
    }
  }
})

// 5. Export Actions and Reducer
export const newMessagesActions = messagesSlice.actions
export default messagesSlice.reducer

// --- Selectors ---
import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from './index' // Adjust path if necessary

// Base selector for the messages slice state
export const selectMessagesState = (state: RootState) => state.messages

// Selectors generated by createEntityAdapter
export const {
  selectAll: selectAllMessages, // Selects all messages as an array
  selectById: selectMessageById, // Selects a single message by ID
  selectIds: selectAllMessageIds, // Selects all message IDs as an array
  selectEntities: selectMessageEntities // Selects the entity dictionary { id: message }
} = messagesAdapter.getSelectors(selectMessagesState)

// Custom Selector: Selects messages for a specific topic in order
export const selectMessagesForTopic = createSelector(
  [
    selectMessageEntities, // Input 1: Get the dictionary of all messages { id: message }
    (state: RootState, topicId: string) => state.messages.messageIdsByTopic[topicId] // Input 2: Get the ordered IDs for the specific topic
  ],
  (messageEntities, topicMessageIds) => {
    // Logger.log(`[Selector selectMessagesForTopic] Running for topicId: ${topicId}`); // Uncomment for debugging selector runs
    if (!topicMessageIds) {
      return [] // Return an empty array if the topic or its IDs don't exist
    }
    // Map the ordered IDs to the actual message objects from the dictionary
    return topicMessageIds.map((id) => messageEntities[id]).filter((m): m is Message => !!m) // Filter out undefined/null in case of inconsistencies
  }
)
