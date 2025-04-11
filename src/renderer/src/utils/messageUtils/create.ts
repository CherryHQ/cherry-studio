import type { Assistant, FileType, Topic, WebSearchResult } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type {
  BaseMessageBlock,
  CitationBlock,
  CodeMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  ThinkingMessageBlock,
  ToolBlock,
  TranslationMessageBlock,
  WebSearchMessageBlock
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
  overrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type'>> = {}
): BaseMessageBlock & { type: T } {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    messageId,
    type,
    createdAt: now,
    status: MessageBlockStatus.PENDING,
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
    usage: overrides.usage,
    metrics: overrides.metrics,
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
    console.warn('Attempted to create ImageBlock with non-image file type:', overrides.file.type)
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
    content
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
  file: FileType,
  overrides: Partial<Omit<FileMessageBlock, 'id' | 'messageId' | 'type' | 'file'>> = {}
): FileMessageBlock {
  if (file.type === FileTypes.IMAGE) {
    console.warn('Use createImageBlock for image file types.')
  }
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.FILE, overrides),
    file
  }
}

/**
 * Creates an Error Message Block.
 * @param messageId - The ID of the parent message.
 * @param error - The error object/details.
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
 * Creates a Web Search Result Block.
 * @param messageId - The ID of the parent message.
 * @param results - The web search results.
 * @param overrides - Optional properties to override the defaults.
 * @returns A WebSearchMessageBlock object.
 */
export function createWebSearchMessageBlock(
  messageId: string,
  results: WebSearchResult[],
  overrides: Partial<Omit<WebSearchMessageBlock, 'id' | 'messageId' | 'type' | 'results'>> = {}
): WebSearchMessageBlock {
  const { query, ...baseOverrides } = overrides
  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.WEB_SEARCH, baseOverrides)
  return {
    ...baseBlock,
    results,
    query: query
  }
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
  overrides: Partial<Omit<ToolBlock, 'id' | 'messageId' | 'type' | 'toolId'>> = {}
): ToolBlock {
  let initialStatus = MessageBlockStatus.PENDING
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

  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.TOOL, baseOverrides)

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
  citationData: Omit<CitationBlock, keyof BaseMessageBlock | 'type'>,
  overrides: Partial<Omit<CitationBlock, 'id' | 'messageId' | 'type' | keyof typeof citationData>> = {}
): CitationBlock {
  const {
    citationType,
    originalData,
    sourceName,
    groundingMetadata,
    citations,
    annotations,
    webSearchInfo,
    ...baseOverrides
  } = { ...citationData, ...overrides }

  const baseBlock = createBaseMessageBlock(messageId, MessageBlockType.CITATION, {
    status: MessageBlockStatus.SUCCESS,
    ...baseOverrides
  })

  return {
    ...baseBlock,
    citationType: citationType,
    originalData: originalData,
    sourceName: sourceName,
    groundingMetadata: groundingMetadata,
    citations: citations,
    annotations: annotations,
    webSearchInfo: webSearchInfo
  }
}

/**
 * Creates a new Message object
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
  assistantId: string,
  type: 'text' | '@' | 'clear',
  overrides: PartialBy<
    Omit<Message, 'id' | 'role' | 'topicId' | 'assistantId' | 'createdAt' | 'status' | 'type'>,
    'blocks'
  > & { initialContent?: string } = {}
): Message {
  const now = new Date().toISOString()
  const messageId = uuidv4()

  const { initialContent, blocks: initialBlocks, ...restOverrides } = overrides

  let blocks: string[] = initialBlocks || []

  if (initialContent && role !== 'system' && (!initialBlocks || initialBlocks.length === 0)) {
    console.warn('createMessage: initialContent provided but no initialBlocks. Block must be created separately.')
  }

  blocks = blocks.map(String)

  return {
    id: messageId,
    role,
    topicId,
    assistantId,
    type,
    createdAt: now,
    status: role === 'user' ? 'success' : 'sending',
    blocks: blocks,
    ...restOverrides
  }
}

/**
 * Creates a new Assistant Message object (stub) based on the LATEST definition.
 * Contains only metadata, no content or block data initially.
 * @param assistant - The assistant configuration.
 * @param topic - The topic this message belongs to.
 * @param overrides - Optional properties to override the defaults (e.g., model, askId).
 * @returns An Assistant Message stub object.
 */
export function createAssistantMessage(
  assistantId: Assistant['id'],
  topic: Topic,
  overrides: Partial<
    Omit<Message, 'id' | 'role' | 'assistantId' | 'topicId' | 'createdAt' | 'type' | 'status' | 'blocks'>
  > = {}
): Message {
  const now = new Date().toISOString()
  const messageId = uuidv4()

  return {
    id: messageId,
    role: 'assistant',
    assistantId: assistantId,
    topicId: topic.id,
    createdAt: now,
    type: 'text', // Default type
    status: 'sending', // Initial status
    blocks: [], // Initialize with empty block IDs array
    ...overrides
  }
}
