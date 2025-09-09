import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
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

    const filteredMessages4 = filterAdjacentUserMessaegs(filteredMessages3)

    let uiMessages = filterUserRoleStartMessages(
      filterEmptyMessages(filterAfterContextClearMessages(takeRight(filteredMessages4, contextCount + 2))) // 取原来几个provider的最大值
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
