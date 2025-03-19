import { FileTypes, Message as AppMessage } from '@renderer/types'

import { ContentBlock, createBedrockMessage, Message, MessageRole } from '../client/types'

/**
 * Bedrock Message Adapter
 * Converts application messages to Bedrock message format
 */
export class MessageAdapter {
  /**
   * Convert application message to Bedrock message
   * @param message Application message
   * @returns Bedrock message
   */
  public static async fromAppMessage(message: AppMessage): Promise<Message> {
    const content = await this.getMessageContent(message)

    // If the message has no files, return just the text content
    if (!message.files || message.files.length === 0) {
      return createBedrockMessage(message.role as MessageRole, content)
    }

    // Process message with files
    const contentBlocks: ContentBlock[] = []

    // Add text content
    if (content) {
      contentBlocks.push({ text: content })
    }

    // Process files
    for (const file of message.files) {
      if (file.type === FileTypes.IMAGE) {
        // Currently Bedrock doesn't support direct image passing, convert image to text description
        contentBlocks.push({
          text: `[Image: ${file.origin_name}]`
        })
      }

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await window.api.file.read(file.id + file.ext)
        contentBlocks.push({
          text: `${file.origin_name}\n${fileContent.trim()}`
        })
      }
    }

    return {
      role: message.role as MessageRole,
      content: contentBlocks
    }
  }

  /**
   * Get message content
   * @param message Application message
   * @returns Message content
   */
  private static async getMessageContent(message: AppMessage): Promise<string> {
    return message.content || ''
  }

  /**
   * Convert multiple application messages to Bedrock messages
   * @param messages Application message array
   * @returns Bedrock message array
   */
  public static async fromAppMessages(messages: AppMessage[]): Promise<Message[]> {
    const bedrockMessages: Message[] = []

    for (const message of messages) {
      bedrockMessages.push(await this.fromAppMessage(message))
    }

    return bedrockMessages
  }
}
