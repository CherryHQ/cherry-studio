import { StreamTextParams } from '@cherrystudio/ai-core'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/transformParameters'
import { Assistant, Message } from '@renderer/types'
import { isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'

export class ConversationService {
  static async prepareMessagesForLlm(messages: Message[], assistant: Assistant): Promise<StreamTextParams['messages']> {
    const { contextCount } = getAssistantSettings(assistant)
    // This logic is extracted from the original ApiService.fetchChatCompletion
    const contextMessages = filterContextMessages(messages)
    const filteredMessages = filterUsefulMessages(contextMessages)
    // Take the last `contextCount` messages, plus 2 to allow for a final user/assistant exchange.
    const finalMessages = filterUserRoleStartMessages(
      filterEmptyMessages(takeRight(filteredMessages, contextCount + 2))
    )
    return await convertMessagesToSdkMessages(finalMessages, assistant.model || getDefaultModel())
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
