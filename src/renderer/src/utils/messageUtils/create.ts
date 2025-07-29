import { loggerService } from '@logger'
import type { Assistant, FileMetadata, Topic } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type {
  BaseMessageBlock,
  CitationMessageBlock,
  CodeMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  ThinkingMessageBlock,
  ToolMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import {
  AssistantMessageStatus,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { v4 as uuidv4 } from 'uuid'

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

const logger = loggerService.withContext('Utils:MessageUtils')

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
  overrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type'>> = {}
): BaseMessageBlock & { type: T } {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    messageId,
    type,
    createdAt: now,
    status: MessageBlockStatus.PROCESSING,
    error: undefined,
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
  overrides: Partial<Omit<MainTextMessageBlock, 'id' | 'messageId' | 'type' | 'content'>> = {}
): MainTextMessageBlock {
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.MAIN_TEXT, overrides)
  return {
    ...baseBlock,
    content,
    knowledgeBaseIds: overrides.knowledgeBaseIds
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
  overrides: Partial<Omit<CodeMessageBlock, 'id' | 'messageId' | 'type' | 'content' | 'language'>> = {}
): CodeMessageBlock {
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.CODE, overrides)
  return {
    ...baseBlock,
    content,
    language
  }
}

/**
 * Creates an Image Message Block.
 * @param messageId - The ID of the parent message.
 * @param overrides - Optional properties to override the defaults.
 * @returns An ImageMessageBlock object.
 */
export function createImageBlock(
  messageId: string,
  overrides: Partial<Omit<ImageMessageBlock, 'id' | 'messageId' | 'type'>> = {}
): ImageMessageBlock {
  if (overrides.file && overrides.file.type !== FileTypes.IMAGE) {
    logger.warn(`Attempted to create ImageBlock with non-image file type: ${overrides.file.type}`)
  }
  const { file, url, metadata, ...baseOverrides } = overrides
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.IMAGE, baseOverrides)
  return {
    ...baseBlock,
    url: url,
    file: file,
    metadata: metadata
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
  content: string = '',
  overrides: Partial<Omit<ThinkingMessageBlock, 'id' | 'messageId' | 'type' | 'content'>> = {}
): ThinkingMessageBlock {
  const baseOverrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type'>> = {
    status: MessageBlockStatus.PROCESSING,
    ...overrides
  }
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.THINKING, baseOverrides)
  return {
    ...baseBlock,
    content,
    thinking_millsec: overrides.thinking_millsec
  }
}

/**
 * Creates a Translation Message Block.
 * @param messageId - The ID of the parent message.
 * @param content - The translation content.
 * @param targetLanguage - The target language of the translation.
 * @param overrides - Optional properties to override the defaults.
 * @returns A TranslationMessageBlock object.
 */
export function createTranslationBlock(
  messageId: string,
  content: string,
  targetLanguage: string,
  overrides: Partial<Omit<TranslationMessageBlock, 'id' | 'messageId' | 'type' | 'content' | 'targetLanguage'>> = {}
): TranslationMessageBlock {
  const { sourceBlockId, sourceLanguage, ...baseOverrides } = overrides
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.TRANSLATION, {
    status: MessageBlockStatus.SUCCESS,
    ...baseOverrides
  })
  return {
    ...baseBlock,
    content,
    targetLanguage,
    sourceBlockId: sourceBlockId,
    sourceLanguage: sourceLanguage
  }
}

/**
 * Creates a File Message Block.
 * @param messageId - The ID of the parent message.
 * @param file - The file object.
 * @param overrides - Optional properties to override the defaults.
 * @returns A FileMessageBlock object.
 */
export function createFileBlock(
  messageId: string,
  file: FileMetadata,
  overrides: Partial<Omit<FileMessageBlock, 'id' | 'messageId' | 'type' | 'file'>> = {}
): FileMessageBlock {
  if (file.type === FileTypes.IMAGE) {
    logger.warn('Use createImageBlock for image file types.')
  }
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.FILE, overrides),
    file
  }
}

/**
 * Creates an Error Message Block.
 * @param messageId - The ID of the parent message.
 * @param errorData
 * @param overrides - Optional properties to override the defaults.
 * @returns An ErrorMessageBlock object.
 */
export function createErrorBlock(
  messageId: string,
  errorData: Record<string, any>,
  overrides: Partial<Omit<ErrorMessageBlock, 'id' | 'messageId' | 'type' | 'error'>> = {}
): ErrorMessageBlock {
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.ERROR, {
    status: MessageBlockStatus.ERROR,
    error: errorData,
    ...overrides
  })
  return baseBlock as ErrorMessageBlock
}

/**
 * Creates a Tool Block.
 * @param messageId - The ID of the parent message.
 * @param toolId - The ID of the tool.
 * @param overrides - Optional properties to override the defaults.
 * @returns A ToolBlock object.
 */
export function createToolBlock(
  messageId: string,
  toolId: string,
  overrides: Partial<Omit<ToolMessageBlock, 'id' | 'messageId' | 'type' | 'toolId'>> = {}
): ToolMessageBlock {
  let initialStatus = MessageBlockStatus.PROCESSING
  if (overrides.content !== undefined || overrides.error !== undefined) {
    initialStatus = overrides.error ? MessageBlockStatus.ERROR : MessageBlockStatus.SUCCESS
  } else if (overrides.toolName || overrides.arguments) {
    initialStatus = MessageBlockStatus.PROCESSING
  }

  const { toolName, arguments: args, content, error, metadata, ...baseOnlyOverrides } = overrides
  const baseOverrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type'>> = {
    status: initialStatus,
    error: error,
    metadata: metadata,
    ...baseOnlyOverrides
  }
  logger.info('createToolBlock_baseOverrides', baseOverrides.metadata)
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.TOOL, baseOverrides)
  logger.info('createToolBlock_baseBlock', baseBlock.metadata)
  return {
    ...baseBlock,
    toolId,
    toolName,
    arguments: args,
    content
  }
}

/**
 * Creates a Citation Block.
 * @param messageId - The ID of the parent message.
 * @param citationData - The citation data.
 * @param overrides - Optional properties to override the defaults.
 * @returns A CitationBlock object.
 */
export function createCitationBlock(
  messageId: string,
  citationData: Omit<CitationMessageBlock, keyof BaseMessageBlock | 'type'>,
  overrides: Partial<Omit<CitationMessageBlock, 'id' | 'messageId' | 'type' | keyof typeof citationData>> = {}
): CitationMessageBlock {
  const { response, knowledge, memories, ...baseOverrides } = {
    ...citationData,
    ...overrides
  }

  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.CITATION, {
    status: MessageBlockStatus.SUCCESS,
    ...baseOverrides
  })

  return {
    ...baseBlock,
    response,
    knowledge,
    memories
  }
}

/**
 * Creates a new Message object
 * @param role - The role of the message sender ('user' or 'assistant').
 * @param topicId - The ID of the topic this message belongs to.
 * @param assistantId - The ID of the assistant (relevant for assistant messages).
 * @param overrides - Optional properties to override the defaults. Initial blocks can be passed here.
 * @returns A Message object.
 */
export function createMessage(
  role: 'user' | 'assistant' | 'system',
  topicId: string,
  assistantId: string,
  overrides: PartialBy<Omit<Message, 'role' | 'topicId' | 'assistantId' | 'createdAt' | 'status'>, 'blocks' | 'id'> = {}
): Message {
  const now = new Date().toISOString()
  const messageId = overrides.id || uuidv4()

  const { blocks: initialBlocks, id, ...restOverrides } = overrides

  let blocks: string[] = initialBlocks || []

  if (role !== 'system' && (!initialBlocks || initialBlocks.length === 0)) {
    logger.warn('createMessage: initialContent provided but no initialBlocks. Block must be created separately.')
  }

  blocks = blocks.map(String)

  return {
    id: id ?? messageId,
    role,
    topicId,
    assistantId,
    createdAt: now,
    status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.PENDING,
    blocks,
    ...restOverrides
  }
}

/**
 * Creates a new Assistant Message object (stub) based on the LATEST definition.
 * Contains only metadata, no content or block data initially.
 * @param assistantId
 * @param topicId
 * @param overrides - Optional properties to override the defaults (e.g., model, askId).
 * @returns An Assistant Message stub object.
 */
export function createAssistantMessage(
  assistantId: Assistant['id'],
  topicId: Topic['id'],
  overrides: Partial<Omit<Message, 'id' | 'role' | 'assistantId' | 'topicId' | 'createdAt' | 'type' | 'status'>> = {}
): Message {
  const now = new Date().toISOString()
  const messageId = uuidv4()

  return {
    id: messageId,
    role: 'assistant',
    assistantId: assistantId,
    topicId,
    createdAt: now,
    status: AssistantMessageStatus.PENDING, // Initial status
    blocks: [], // Initialize with empty block IDs array
    ...overrides
  }
}

/**
 * Creates a new Message object based on an existing one, resetting mutable fields
 * typically needed before regeneration or significant updates.
 * This function is pure and does not interact with the Redux store.
 * The caller is responsible for managing the removal of old blocks from the store if necessary.
 *
 * @param originalMessage - The message to reset.
 * @param updates - Optional updates for model, modelId, and status.
 * @returns A new Message object with reset fields.
 */
export function resetMessage(
  originalMessage: Message,
  updates: Partial<Pick<Message, 'model' | 'modelId' | 'status' | 'blocks'>> = {}
): Message {
  return {
    // Keep immutable core properties
    id: originalMessage.id,
    role: originalMessage.role,
    topicId: originalMessage.topicId,
    assistantId: originalMessage.assistantId,
    type: originalMessage.type,
    createdAt: originalMessage.createdAt, // Keep original creation timestamp

    // Apply updates or use existing values
    model: updates.model ?? originalMessage.model,
    modelId: updates.modelId ?? originalMessage.modelId,
    status: updates.status ?? AssistantMessageStatus.PENDING, // Default reset status to 'processing'

    // Reset mutable/volatile properties
    blocks: updates.blocks ?? [], // Always clear blocks array
    useful: undefined,
    askId: undefined,
    mentions: undefined,
    enabledMCPs: undefined
    // NOTE: Add any other fields here that should be reset upon message regeneration
  }
}

/**
 * Resets an existing assistant message to a clean state, ready for regeneration.
 * It clears blocks and response-specific data, while retaining core identifiers.
 *
 * @param originalMessage The assistant message to reset.
 * @param updates Optional partial message object to override default reset values (e.g., status).
 * @returns A new message object representing the reset state.
 */
export const resetAssistantMessage = (
  originalMessage: Message,
  updates?: Partial<Pick<Message, 'status' | 'updatedAt' | 'model' | 'modelId'>> // Primarily allow updating status
): Message => {
  // Ensure we are only resetting assistant messages
  if (originalMessage.role !== 'assistant') {
    logger.warn(
      `[resetAssistantMessage] Attempted to reset a non-assistant message (ID: ${originalMessage.id}, Role: ${originalMessage.role}). Returning original.`
    )
    return originalMessage
  }

  // Create the base reset message
  return {
    // --- Retain Core Identifiers ---
    id: originalMessage.id, // Keep the same message ID
    topicId: originalMessage.topicId,
    askId: originalMessage.askId, // Keep the link to the original user query

    // --- Retain Identity ---
    role: 'assistant',
    assistantId: originalMessage.assistantId,
    model: originalMessage.model, // Keep the model information
    modelId: originalMessage.modelId,

    // --- Reset Response Content & Status ---
    blocks: [], // <<< CRITICAL: Clear the blocks array
    mentions: undefined, // Clear any mentions
    status: AssistantMessageStatus.PENDING, // Default to PENDING
    metrics: undefined, // Clear performance metrics
    usage: undefined, // Clear token usage data

    // --- Timestamps ---
    createdAt: originalMessage.createdAt, // Keep original creation timestamp

    // --- Apply Overrides ---
    ...updates // Apply any specific updates passed in (e.g., a different status)
  }
}

// 需要一个重置助手消息
