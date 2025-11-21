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
  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   */
  static filterMessagesPipeline(messages: Message[], contextCount: number): Message[] {
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
    // Run the error-only filter before trimming trailing assistant responses so the pair is removed together.
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
    const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)
    const limitedByContext = takeRight(withoutAdjacentUsers, contextCount + 2)
    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
    return filterUserRoleStartMessages(nonEmptyMessages)
  }

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

    const uiMessagesFromPipeline = ConversationService.filterMessagesPipeline(messages, contextCount)

    // Fallback: ensure at least the last user message is present to avoid empty payloads
    let uiMessages = uiMessagesFromPipeline
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
