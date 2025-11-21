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

    // Step 1: Filter messages after the last context clear marker
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)

    // Step 2: Keep only useful messages (based on useful flag)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)

    // Step 3: Remove trailing assistant messages
    const withoutTrailingAssistant = filterLastAssistantMessage(usefulMessages)

    // Step 4: Filter out error-only assistant messages and their associated user messages
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(withoutTrailingAssistant)

    // Step 5: Filter adjacent user messages, keeping only the last one
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutErrorOnlyPairs)

    // Step 6: Apply context limit and final filters
    // Take the last N messages based on context count (取原来几个provider的最大值)
    const limitedByContext = takeRight(withoutAdjacentUsers, contextCount + 2)

    // Filter again after context clear (in case context limit included old messages)
    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)

    // Remove empty messages
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)

    // Ensure messages start with a user message
    let uiMessages = filterUserRoleStartMessages(nonEmptyMessages)

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
