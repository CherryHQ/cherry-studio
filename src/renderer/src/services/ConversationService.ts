import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import type { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'

export class ConversationService {
  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    const { contextCount } = getAssistantSettings(assistant)
    // This logic is extracted from the original ApiService.fetchChatCompletion
    // const contextMessages = filterContextMessages(messages)
    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if (!lastUserMessage) {
      return {
        modelMessages: [],
        uiMessages: []
      }
    }

    const filteredMessages1 = filterAfterContextClearMessages(messages)

    const filteredMessages2 = filterUsefulMessages(filteredMessages1)

    const filteredMessages3 = filterLastAssistantMessage(filteredMessages2)

    // Filter out error-only assistant messages and their associated user messages
    const filteredMessages4 = filterErrorOnlyMessagesWithRelated(filteredMessages3)

    const filteredMessages5 = filterAdjacentUserMessaegs(filteredMessages4)

    let uiMessages = filterUserRoleStartMessages(
      filterEmptyMessages(filterAfterContextClearMessages(takeRight(filteredMessages5, contextCount + 2))) // 取原来几个provider的最大值
    )

    // Fallback: ensure at least the last user message is present to avoid empty payloads
    if ((!uiMessages || uiMessages.length === 0) && lastUserMessage) {
      uiMessages = [lastUserMessage]
    }

    return {
      modelMessages: await convertMessagesToSdkMessages(uiMessages, assistant.model || getDefaultModel()),
      uiMessages
    }
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
