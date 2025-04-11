import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Topic } from '@renderer/types'
import type {
  BaseMessageBlock,
  BlockUpdateData,
  MainTextMessageBlock,
  Message,
  MessageBlock,
  MessagesState
} from '@renderer/types/newMessageTypes'
import { MessageBlockType } from '@renderer/types/newMessageTypes'
import { v4 as uuidv4 } from 'uuid'

const initialState: MessagesState = {
  messagesByTopic: {},
  streamBlocksByMessage: {},
  currentTopic: null,
  loadingByTopic: {},
  displayCount: 50, // Default display count, adjust as needed
  error: null
}

const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setCurrentTopic(state, action: PayloadAction<Topic | null>) {
      state.currentTopic = action.payload
      if (action.payload && !(action.payload.id in state.messagesByTopic)) {
        state.messagesByTopic[action.payload.id] = []
        state.loadingByTopic[action.payload.id] = false
      }
      state.error = null // Clear error when changing topic
    },
    setLoading(state, action: PayloadAction<{ topicId: string; isLoading: boolean }>) {
      const { topicId, isLoading } = action.payload
      state.loadingByTopic[topicId] = isLoading
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
    setDisplayCount(state, action: PayloadAction<number>) {
      state.displayCount = action.payload
    },
    addMessage(state, action: PayloadAction<{ topicId: string; message: Message }>) {
      const { topicId, message } = action.payload
      if (!state.messagesByTopic[topicId]) {
        state.messagesByTopic[topicId] = []
      }
      // Ensure message has a blocks array if not provided
      const messageWithDefaults = {
        ...message,
        blocks: message.blocks || []
      }
      state.messagesByTopic[topicId].push(messageWithDefaults)

      // Initialize stream blocks cache for this message
      if (!state.streamBlocksByMessage[message.id]) {
        state.streamBlocksByMessage[message.id] = {}
      }
    },
    updateMessage(state, action: PayloadAction<{ topicId: string; messageId: string; updates: Partial<Message> }>) {
      const { topicId, messageId, updates } = action.payload
      const topicMessages = state.messagesByTopic[topicId]
      if (topicMessages) {
        const messageIndex = topicMessages.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          topicMessages[messageIndex] = {
            ...topicMessages[messageIndex],
            ...updates,
            updatedAt: new Date().toISOString() // Always update timestamp on modification
          }
        }
      }
    },
    clearTopicMessages(state, action: PayloadAction<string>) {
      const topicId = action.payload
      if (state.messagesByTopic[topicId]) {
        // Also clear related stream blocks
        state.messagesByTopic[topicId].forEach((msg) => {
          delete state.streamBlocksByMessage[msg.id]
        })
        state.messagesByTopic[topicId] = []
      }
      state.loadingByTopic[topicId] = false
      state.error = null
    },
    upsertStreamBlock(state, action: PayloadAction<BlockUpdateData>) {
      const {
        messageId,
        blockId: providedBlockId,
        type,
        content,
        status,
        append,
        metadata,
        usage,
        metrics,
        language // Specific to CodeBlock
        // Add other potential fields from BlockUpdateData if needed
      } = action.payload

      const now = new Date().toISOString()
      const timestamp = Date.now()

      // Find the topic containing the message
      let targetTopicId: string | null = null
      for (const topicId in state.messagesByTopic) {
        if (state.messagesByTopic[topicId].some((msg) => msg.id === messageId)) {
          targetTopicId = topicId
          break
        }
      }

      if (!targetTopicId) {
        console.error(`Message ${messageId} not found in any topic.`)
        return // Or handle error appropriately
      }

      const messageIndex = state.messagesByTopic[targetTopicId].findIndex((msg) => msg.id === messageId)
      if (messageIndex === -1) {
        console.error(`Message ${messageId} not found in topic ${targetTopicId}.`)
        return
      }

      // Ensure stream block cache exists for the message
      if (!state.streamBlocksByMessage[messageId]) {
        state.streamBlocksByMessage[messageId] = {}
      }

      const blockId = providedBlockId || uuidv4() // Generate ID if creating a new block
      const existingBlock = state.streamBlocksByMessage[messageId]?.[blockId] as BaseMessageBlock | undefined

      // Construct the updated/new block
      let updatedBlock: MessageBlock

      if (existingBlock) {
        // Update existing block
        const currentContent = existingBlock.content
        let newContent: string | object | undefined

        if (content !== undefined) {
          if (
            append &&
            typeof currentContent === 'string' &&
            typeof content === 'string' &&
            (type === MessageBlockType.MAIN_TEXT ||
              type === MessageBlockType.THINKING ||
              type === MessageBlockType.CODE ||
              type === MessageBlockType.TOOL_RESULT || // Assuming tool result can be string
              type === MessageBlockType.ERROR) // Assuming error content is string
          ) {
            newContent = currentContent + content
          } else {
            newContent = content // Replace or set if not string/appendable
          }
        } else {
          newContent = currentContent // Keep existing content if no new content provided
        }

        updatedBlock = {
          ...(existingBlock as any), // Cast needed due to discriminated union complexity
          content: newContent, // Apply potentially appended/updated content
          status: status || existingBlock.status,
          updatedAt: now,
          metadata: metadata ? { ...existingBlock.metadata, ...metadata } : existingBlock.metadata,
          // --- Type Specific Updates ---
          ...(type === MessageBlockType.MAIN_TEXT && { usage, metrics }),
          ...(type === MessageBlockType.CODE && language && { language })
          // Add other type-specific fields as needed
        }
      } else {
        // Create new block
        const baseBlock: BaseMessageBlock = {
          id: blockId,
          messageId: messageId,
          type: type,
          createdAt: now,
          status: status || 'processing', // Default to processing if new
          content: content,
          metadata: metadata
          // Add other common fields if necessary
        }

        // Use discriminated union based on type
        switch (type) {
          case MessageBlockType.MAIN_TEXT:
            updatedBlock = {
              ...baseBlock,
              type: MessageBlockType.MAIN_TEXT,
              content: typeof content === 'string' ? content : '', // Ensure content is string
              usage: usage,
              metrics: metrics
            } as MainTextMessageBlock
            break
          // Add cases for all other MessageBlockType enums, casting appropriately
          // e.g., case MessageBlockType.CODE: updatedBlock = { ...baseBlock, type: MessageBlockType.CODE, content: typeof content === 'string' ? content : '', language: language || '' } as CodeMessageBlock; break;
          // ... other cases ...
          default:
            // Fallback or handle unknown type - maybe create a generic block or throw error
            console.warn(`Unhandled block type in upsertStreamBlock: ${type}`)
            // For now, create a basic block; adjust as needed
            updatedBlock = {
              ...baseBlock,
              content: content // Keep original content type
            } as BaseMessageBlock // Cast to BaseMessageBlock or a specific default
            break
        }
      }

      // Update the block in the stream cache
      state.streamBlocksByMessage[messageId][blockId] = updatedBlock

      // Update the message in messagesByTopic
      const message = state.messagesByTopic[targetTopicId][messageIndex]
      message.updatedAt = now
      if (status) {
        // Map block status to message status if needed (e.g., if last block finishes -> message success)
        // This logic might be complex and depend on your specific requirements
        // For now, let's update message status directly if the block status implies message processing/error
        if (status === 'processing' && message.status === 'sending') {
          message.status = 'processing'
        } else if (status === 'error') {
          message.status = 'error'
          // Maybe update message.error based on block.error?
        } else if (status === 'success') {
          // Determine if the *entire* message is successful (e.g., all blocks done?)
          // This might require checking all blocks for the message.
          // Let's keep it simple for now and not automatically set message to success here.
        }
      }

      // Update the quick access content field if it's the main text block
      if (updatedBlock.type === MessageBlockType.MAIN_TEXT) {
        message.content = (updatedBlock as MainTextMessageBlock).content
      }

      // Add/Update block reference in the message's blocks array
      const blockRefIndex = message.blocks.findIndex((b) => b.id === blockId)
      if (blockRefIndex !== -1) {
        message.blocks[blockRefIndex].timestamp = timestamp // Update timestamp if exists
      } else {
        message.blocks.push({ id: blockId, timestamp: timestamp })
        // Optional: Sort blocks by timestamp to maintain order?
        // message.blocks.sort((a, b) => a.timestamp - b.timestamp);
      }
    }
    // Potentially add reducers for deleting messages, deleting topics etc.
  }
})

export const {
  setCurrentTopic,
  setLoading,
  setError,
  setDisplayCount,
  addMessage,
  updateMessage,
  clearTopicMessages,
  upsertStreamBlock
} = messagesSlice.actions

export default messagesSlice.reducer
