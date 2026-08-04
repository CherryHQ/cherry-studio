import type { Assistant } from '@renderer/types/assistant'
import type { MessageBlockStatus } from '@renderer/types/newMessage'
import {
  type MainTextMessageBlock,
  type Message,
  type ThinkingMessageBlock,
  type ToolMessageBlock
} from '@renderer/types/newMessage'
import type { Topic } from '@renderer/types/topic'

type ImportToolMessageBlockBase = Omit<ToolMessageBlock, 'arguments' | 'content' | 'status' | 'toolName'> & {
  arguments: Record<string, unknown>
  toolName: string
}

export type ImportToolMessageBlock = ImportToolMessageBlockBase &
  ({ content: string; status: MessageBlockStatus.ERROR } | { content?: string; status: MessageBlockStatus.SUCCESS })

export type ImportMessageBlock = MainTextMessageBlock | ThinkingMessageBlock | ImportToolMessageBlock

/**
 * Import result containing parsed data
 */
export interface ImportResult {
  topics: Topic[]
  messages: Message[]
  blocks: ImportMessageBlock[]
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
