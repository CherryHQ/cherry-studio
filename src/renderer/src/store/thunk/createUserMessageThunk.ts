// Import the pure function from MessagesService
import { getUserMessage as createPureUserMessageAndBlocks } from '@renderer/services/MessagesService'
import type { AppDispatch } from '@renderer/store'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant, FileType, MCPServer, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessageTypes'

interface CreateUserMessagePayload {
  userInput: {
    content?: string
    files?: FileType[]
    // Add other potential user inputs here if needed by createPureUserMessageAndBlocks
    knowledgeBaseIds?: string[]
    mentions?: Model[]
    enabledMCPs?: MCPServer[]
  }
  assistant: Assistant
  topic: Topic
  messageType?: Message['type'] // Optional type, default handled in createPureUserMessageAndBlocks
}

/**
 * Thunk action to create a user message, associated blocks, and add them to the store.
 *
 * @param payload - The necessary data to create the user message.
 */
export const createUserMessageThunk = (payload: CreateUserMessagePayload) => async (dispatch: AppDispatch) => {
  const { userInput, assistant, topic, messageType } = payload

  try {
    // 1. Create the message and blocks using the pure function
    const { message, blocks } = createPureUserMessageAndBlocks({
      assistant,
      topic,
      type: messageType || 'text', // Provide a default type
      content: userInput.content,
      files: userInput.files,
      // Pass other potential params if needed
      knowledgeBaseIds: userInput.knowledgeBaseIds,
      mentions: userInput.mentions,
      enabledMCPs: userInput.enabledMCPs
    })

    // 2. Dispatch actions to add blocks and the message to the respective stores
    if (blocks.length > 0) {
      dispatch(upsertManyBlocks(blocks))
    }
    dispatch(newMessagesActions.addMessage({ topicId: topic.id, message }))

    // TODO: Decide if saving to DB should happen here or be triggered elsewhere
    // await saveMessageAndBlocksToDB(message, blocks); // Example from messageThunk

    // Return the created message maybe? Or void?
    return message // Example: return the created message
  } catch (error) {
    console.error('Error in createUserMessageThunk:', error)
    // Optionally dispatch an error action
  }
}
