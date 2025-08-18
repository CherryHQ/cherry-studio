import { StreamTextParams } from '@cherrystudio/ai-core'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/transformParameters'
import { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { isEmpty, takeRight } from 'lodash'

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
  ): Promise<StreamTextParams['messages']> {
    const { contextCount } = getAssistantSettings(assistant)
    // This logic is extracted from the original ApiService.fetchChatCompletion
    // const contextMessages = filterContextMessages(messages)
    const filteredMessages1 = filterAfterContextClearMessages(messages)

    const filteredMessages2 = filterUsefulMessages(filteredMessages1)

    const filteredMessages3 = filterLastAssistantMessage(filteredMessages2)

    const filteredMessages4 = filterAdjacentUserMessaegs(filteredMessages3)

    const _messages = filterUserRoleStartMessages(
      filterEmptyMessages(filterAfterContextClearMessages(takeRight(filteredMessages4, contextCount + 2))) // 取原来几个provider的最大值
    )

    const filteredMessages = filterUsefulMessages(_messages)
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
