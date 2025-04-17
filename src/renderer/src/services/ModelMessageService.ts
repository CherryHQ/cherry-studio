import { Model } from '@renderer/types'
import { ChatCompletionMessageParam } from 'openai/resources'

export function processReqMessages(
  model: Model,
  reqMessages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  if (!needStrictlyInterleaveUserAndAssistantMessages(model)) {
    return reqMessages
  }

  return mergeSameRoleMessages(reqMessages)
}

function needStrictlyInterleaveUserAndAssistantMessages(model: Model) {
  return model.id === 'deepseek-reasoner'
}

/**
 * Merge successive messages with the same role
 */
function mergeSameRoleMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  const split = '\n'
  const processedMessages: ChatCompletionMessageParam[] = []
  let currentGroup: ChatCompletionMessageParam[] = []

  for (const message of messages) {
    if (currentGroup.length === 0 || currentGroup[0].role === message.role) {
      currentGroup.push(message)
    } else {
      // merge the current group and add to processed messages
      processedMessages.push({
        ...currentGroup[0],
        content: currentGroup.map((m) => m.content).join(split)
      })
      currentGroup = [message]
    }
  }

  // process the last group
  if (currentGroup.length > 0) {
    processedMessages.push({
      ...currentGroup[0],
      content: currentGroup.map((m) => m.content).join(split)
    })
  }

  return processedMessages
}
