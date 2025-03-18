import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import type { Assistant, Message } from '@renderer/types'
import { takeRight } from 'lodash'

/**
 * Message Processor
 * Handles message filtering and processing
 */
export class MessageProcessor {
  /**
   * Filter messages
   * Applies filtering rules to messages
   *
   * @param messages Message array
   * @param assistant Assistant
   * @returns Filtered message array
   */
  public static filterMessages(messages: Message[], assistant: Assistant): Message[] {
    const contextCount = assistant.settings?.contextCount || 10
    return filterUserRoleStartMessages(
      filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 1)))
    )
  }

  /**
   * Get assistant settings
   * @param assistant Assistant object
   * @returns Assistant settings
   */
  public static getAssistantSettings(assistant: Assistant): { streamOutput: boolean } {
    return {
      streamOutput: assistant.settings?.streamOutput !== false
    }
  }
}
