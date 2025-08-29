import { Model } from '@renderer/types'
import { findLast } from 'lodash'
import { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources'

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

// Process postsuffix for Qwen3 model
export function processPostsuffixQwen3Model(
  // content 類型：string | ChatCompletionContentPart[]
  content: string | ChatCompletionContentPart[],
  qwenThinkModeEnabled: boolean
): string | ChatCompletionContentPart[] {
  const noThinkSuffix = '/no_think'
  const thinkSuffix = '/think'
  if (typeof content === 'string') {
    if (qwenThinkModeEnabled) {
      if (!content.endsWith(thinkSuffix)) {
        return content + ' ' + thinkSuffix
      }
    } else {
      if (!content.endsWith(noThinkSuffix)) {
        return content + ' ' + noThinkSuffix
      }
    }
  } else if (Array.isArray(content)) {
    const lastTextPart = findLast(content, (part) => part.type === 'text')

    if (lastTextPart) {
      if (qwenThinkModeEnabled) {
        if (!lastTextPart.text.endsWith(thinkSuffix)) {
          lastTextPart.text += thinkSuffix
        }
      } else {
        if (!lastTextPart.text.endsWith(noThinkSuffix)) {
          lastTextPart.text += noThinkSuffix
        }
      }
    } else {
      // 數組中沒有文本部分
      if (qwenThinkModeEnabled) {
        // 思考模式未啓用，需要添加 postsuffix
        // 如果沒有文本部分，則添加一個新的文本部分
        content.push({ type: 'text', text: thinkSuffix })
      } else {
        content.push({ type: 'text', text: noThinkSuffix })
      }
    }
  }
  return content
}
