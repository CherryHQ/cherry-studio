import type {
  BaseMessageBlock,
  CodeMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  ThinkingMessageBlock
} from '@renderer/types/newMessageTypes'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessageTypes'
import { v4 as uuidv4 } from 'uuid'

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Creates a base message block with common properties.
 * @param messageId - The ID of the parent message.
 * @param type - The type of the message block.
 * @param overrides - Optional properties to override the defaults.
 * @returns A BaseMessageBlock object.
 */
export function createBaseMessageBlock<T extends MessageBlockType>(
  messageId: string,
  type: T,
  overrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type' | 'createdAt'>> = {}
): BaseMessageBlock & { type: T } {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    messageId,
    type,
    createdAt: now,
    status: MessageBlockStatus.PENDING, // Default status
    ...overrides
  }
}

/**
 * Creates a Main Text Message Block.
 * @param messageId - The ID of the parent message.
 * @param content - The main text content.
 * @param overrides - Optional properties to override the defaults.
 * @returns A MainTextMessageBlock object.
 */
export function createMainTextBlock(
  messageId: string,
  content: string,
  overrides: Partial<Omit<MainTextMessageBlock, 'id' | 'messageId' | 'type' | 'createdAt' | 'content'>> = {}
): MainTextMessageBlock {
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.MAIN_TEXT, overrides),
    content
  }
}

/**
 * Creates a Code Message Block.
 * @param messageId - The ID of the parent message.
 * @param content - The code content.
 * @param language - The programming language of the code.
 * @param overrides - Optional properties to override the defaults.
 * @returns A CodeMessageBlock object.
 */
export function createCodeBlock(
  messageId: string,
  content: string,
  language: string,
  overrides: Partial<Omit<CodeMessageBlock, 'id' | 'messageId' | 'type' | 'createdAt' | 'content' | 'language'>> = {}
): CodeMessageBlock {
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.CODE, overrides),
    content,
    language
  }
}

/**
 * Creates an Image Message Block.
 * @param messageId - The ID of the parent message.
 * @param url - The URL of the image.
 * @param overrides - Optional properties to override the defaults.
 * @returns An ImageMessageBlock object.
 */
export function createImageBlock(
  messageId: string,
  url: string,
  overrides: Partial<Omit<ImageMessageBlock, 'id' | 'messageId' | 'type' | 'createdAt' | 'url'>> = {}
): ImageMessageBlock {
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.IMAGE, overrides),
    url
  }
}

/**
 * Creates a Thinking Message Block.
 * @param messageId - The ID of the parent message.
 * @param content - The thinking process content.
 * @param overrides - Optional properties to override the defaults.
 * @returns A ThinkingMessageBlock object.
 */
export function createThinkingBlock(
  messageId: string,
  content: string = '', // Often starts empty and gets updated
  overrides: Partial<Omit<ThinkingMessageBlock, 'id' | 'messageId' | 'type' | 'createdAt' | 'content'>> = {}
): ThinkingMessageBlock {
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.THINKING, {
      status: MessageBlockStatus.PROCESSING, // Thinking usually starts immediately
      ...overrides
    }),
    content
  }
}

// --- Add more specific block creation functions as needed ---
// e.g., createToolCallBlock, createFileBlock, createErrorBlock, etc.

/**
 * Creates a new Message object.
 * @param role - The role of the message sender ('user' or 'assistant').
 * @param topicId - The ID of the topic this message belongs to.
 * @param assistantId - The ID of the assistant (relevant for assistant messages).
 * @param type - The type of the message ('text', '@', 'clear').
 * @param overrides - Optional properties to override the defaults. Initial blocks can be passed here.
 * @returns A Message object.
 */
export function createMessage(
  role: 'user' | 'assistant' | 'system',
  topicId: string,
  assistantId: string, // Consider making optional if role is 'user' or 'system'
  type: 'text' | '@' | 'clear',
  overrides: PartialBy<
    Omit<Message, 'id' | 'role' | 'topicId' | 'assistantId' | 'createdAt' | 'status' | 'type'>,
    'blocks' | 'updatedAt'
  > & { initialContent?: string } = {} // Add initialContent helper
): Message {
  const now = new Date().toISOString()
  const messageId = uuidv4()

  const { initialContent, blocks: initialBlocks, ...restOverrides } = overrides

  let blocks: { id: string; timestamp: number }[] = initialBlocks || []
  let content: string | undefined = restOverrides.content // Use override content first

  // If initialContent is provided and no blocks were explicitly passed, create a main text block
  if (
    initialContent &&
    role !== 'system' && // Systems messages might not need blocks
    (!initialBlocks || initialBlocks.length === 0) // Simplified check: if no blocks provided explicitly
  ) {
    const mainTextBlock = createMainTextBlock(messageId, initialContent, {
      status: MessageBlockStatus.SUCCESS // Assume initial user content is complete
    })
    blocks = [{ id: mainTextBlock.id, timestamp: Date.now() }]
    content = initialContent // Set top-level content
    // Note: This block isn't automatically added to the Redux store here.
    // The calling code (e.g., dispatching addMessage) needs to handle
    // adding both the message *and* its initial block(s) to the store.
  } else if (blocks.length > 0 && !content) {
    // If blocks are provided but no top-level content, try to infer from first block
    // This logic is simplified and might need refinement based on how you fetch block details.
    // It assumes the first block's content might be the primary content.
    // content = blocks[0].id // This isn't the content itself, placeholder
  }

  return {
    id: messageId,
    role,
    topicId,
    assistantId, // Ensure this is handled correctly for non-assistant roles
    type,
    createdAt: now,
    status: role === 'user' ? 'success' : 'sending', // User messages are complete, assistant messages start sending
    blocks: blocks,
    content: content, // Set based on logic above
    ...restOverrides // Apply other overrides
  }
}
