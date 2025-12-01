import type { Assistant, Topic } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'

/**
 * Import result containing parsed data
 */
export interface ImportResult {
  topics: Topic[]
  messages: Message[]
  blocks: MainTextMessageBlock[]
  metadata?: Record<string, unknown>
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
   * @param assistantId - ID of the assistant to associate with
   * @returns Parsed topics, messages, and blocks
   */
  parse(fileContent: string, assistantId: string): Promise<ImportResult>
}
