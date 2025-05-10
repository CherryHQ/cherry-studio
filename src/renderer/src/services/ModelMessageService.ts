import { Model } from '@renderer/types'
import { ChatCompletionContentPart, ChatCompletionContentPartText, ChatCompletionMessageParam } from 'openai/resources'

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
  // content 類型：string | ChatCompletionContentPart[] | null
  content: string | ChatCompletionContentPart[] | null,
  postsuffix: string,
  qwenThinkModeEnabled: boolean
): string | ChatCompletionContentPart[] | null {
  if (typeof content === 'string') {
    if (qwenThinkModeEnabled) {
      // 思考模式启用，移除 postsuffix
      if (content.endsWith(postsuffix)) {
        return content.substring(0, content.length - postsuffix.length).trimEnd()
      }
    } else {
      // 思考模式未启用，添加 postsuffix
      if (!content.endsWith(postsuffix)) {
        return content + postsuffix
      }
    }
  } else if (Array.isArray(content)) {
    let lastTextPartIndex = -1
    for (let i = content.length - 1; i >= 0; i--) {
      if (content[i].type === 'text') {
        lastTextPartIndex = i
        break
      }
    }

    if (lastTextPartIndex !== -1) {
      const textPart = content[lastTextPartIndex] as ChatCompletionContentPartText
      if (qwenThinkModeEnabled) {
        // 思考模式启用，移除 postsuffix
        if (textPart.text.endsWith(postsuffix)) {
          textPart.text = textPart.text.substring(0, textPart.text.length - postsuffix.length).trimEnd()
          // 可選：如果 textPart.text 變為空，可以考慮是否移除該 part
        }
      } else {
        // 思考模式未启用，添加 postsuffix
        if (!textPart.text.endsWith(postsuffix)) {
          textPart.text += postsuffix
        }
      }
    } else {
      // 數組中沒有文本部分
      if (!qwenThinkModeEnabled) {
        // 思考模式未啓用，需要添加 postsuffix
        // 如果沒有文本部分，則添加一個新的文本部分
        content.push({ type: 'text', text: postsuffix })
      }
    }
  } else {
    // currentContent 是 null
    if (!qwenThinkModeEnabled) {
      // 思考模式未启用，需要添加 postsuffix
      return content
    }
  }
  return content
}
