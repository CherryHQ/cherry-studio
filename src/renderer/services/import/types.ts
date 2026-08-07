import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import type { Assistant } from '@shared/data/types/assistant'
import type { ModelSnapshot } from '@shared/data/types/message'

export interface ImportMessageNode {
  sourceId: string
  parentSourceId?: string
  role: CreateMessageDto['role']
  parts: NonNullable<CreateMessageDto['data']['parts']>
  model?: ModelSnapshot
}

export interface ImportConversation {
  name: string
  messages: ImportMessageNode[]
  activeSourceId?: string
}

/**
 * Import result containing parsed data
 */
export interface ImportResult {
  conversations: ImportConversation[]
}

/**
 * Response returned to caller after import
 */
export interface ImportResponse {
  success: boolean
  assistant?: Assistant
  topicsCount: number
  messagesCount: number
  error?: string
}

/**
 * Base interface for conversation importers
 * Each chat application (ChatGPT, Claude, Gemini, etc.) should implement this interface
 */
export interface ConversationImporter {
  /**
   * Unique name of the importer (e.g., 'ChatGPT', 'Claude', 'Gemini')
   */
  readonly name: string

  /**
   * Emoji or icon for the assistant created by this importer
   */
  readonly emoji: string

  /**
   * Validate if the file content matches this importer's format
   */
  validate(fileContent: string): boolean

  /**
   * Parse file content and convert to unified format
   * @param fileContent - Raw file content (usually JSON string)
   * @returns Parsed conversations containing v2 AI SDK message parts
   */
  parse(fileContent: string): Promise<ImportResult>
}
