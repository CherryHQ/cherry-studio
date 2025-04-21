import { Model } from '@renderer/types'
import { ChatCompletionMessageParam } from 'openai/resources'

export function processReqMessages(
  model: Model,
  reqMessages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  if (!needStrictlyInterleaveUserAndAssistantMessages(model)) {
    return reqMessages
  }

  return interleaveUserAndAssistantMessages(reqMessages)
}

function needStrictlyInterleaveUserAndAssistantMessages(model: Model) {
  return model.id === 'deepseek-reasoner'
}

function interleaveUserAndAssistantMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  if (!messages || messages.length === 0) {
    return []
  }

  const processedMessages: ChatCompletionMessageParam[] = []

  for (let i = 0; i < messages.length; i++) {
    const currentMessage = { ...messages[i] }

    if (i > 0 && currentMessage.role === messages[i - 1].role) {
      // insert an empty message with the opposite role in between
      const emptyMessageRole = currentMessage.role === 'user' ? 'assistant' : 'user'
      processedMessages.push({
        role: emptyMessageRole,
        content: ''
      })
    }

    processedMessages.push(currentMessage)
  }

  return processedMessages
}
