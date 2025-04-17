import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { CitationBlock, Message } from '@renderer/types/newMessageTypes'
import { MessageBlockType } from '@renderer/types/newMessageTypes'

import { findImageBlocks, getMessageContent } from './messageUtils/find'

export function escapeDollarNumber(text: string) {
  let escapedText = ''

  for (let i = 0; i < text.length; i += 1) {
    let char = text[i]
    const nextChar = text[i + 1] || ' '

    if (char === '$' && nextChar >= '0' && nextChar <= '9') {
      char = '\\$'
    }

    escapedText += char
  }

  return escapedText
}

export function escapeBrackets(text: string) {
  const pattern = /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g
  return text.replace(pattern, (match, codeBlock, squareBracket, roundBracket) => {
    if (codeBlock) {
      return codeBlock
    } else if (squareBracket) {
      return `
$$
${squareBracket}
$$
`
    } else if (roundBracket) {
      return `$${roundBracket}$`
    }
    return match
  })
}

export function extractTitle(html: string): string | null {
  const titleRegex = /<title>(.*?)<\/title>/i
  const match = html.match(titleRegex)

  if (match && match[1]) {
    return match[1].trim()
  }

  return null
}

export function removeSvgEmptyLines(text: string): string {
  // 用正则表达式匹配 <svg> 标签内的内容
  const svgPattern = /(<svg[\s\S]*?<\/svg>)/g

  return text.replace(svgPattern, (svgMatch) => {
    // 将 SVG 内容按行分割,过滤掉空行,然后重新组合
    return svgMatch
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n')
  })
}

// Helper function to find the first citation block with grounding metadata
// Ideally, move this to find.ts later
const findCitationBlockWithGrounding = (message: Message): CitationBlock | undefined => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return undefined
  }
  const state = store.getState()
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.CITATION) {
      const citation = block
      if (citation.citationType === 'grounding' && citation.groundingMetadata) {
        return citation
      }
    }
  }
  return undefined
}

export function withGeminiGrounding(message: Message): string {
  const citationBlock = findCitationBlockWithGrounding(message)
  const groundingSupports = citationBlock?.groundingMetadata?.groundingSupports

  let content = getMessageContent(message)

  if (!groundingSupports || groundingSupports.length === 0) {
    return content
  }

  groundingSupports.forEach((support) => {
    const text = support?.segment?.text
    const indices = support?.groundingChunkIndices

    if (!text || !indices) return

    const nodes = indices.reduce((acc, index) => {
      acc.push(`<sup>${index + 1}</sup>`)
      return acc
    }, [] as string[])

    content = content.replace(text, `${text} ${nodes.join(' ')}`)
  })

  return content
}

interface ThoughtProcessor {
  canProcess: (content: string, message?: Message) => boolean
  process: (content: string) => { reasoning: string; content: string }
}

const glmZeroPreviewProcessor: ThoughtProcessor = {
  canProcess: (content: string, message?: Message) => {
    if (!message) return false

    const modelId = message.modelId || ''
    const modelName = message.model?.name || ''
    const isGLMZeroPreview =
      modelId.toLowerCase().includes('glm-zero-preview') || modelName.toLowerCase().includes('glm-zero-preview')

    return isGLMZeroPreview && content.includes('###Thinking')
  },
  process: (content: string) => {
    const parts = content.split('###')
    const thinkingMatch = parts.find((part) => part.trim().startsWith('Thinking'))
    const responseMatch = parts.find((part) => part.trim().startsWith('Response'))

    return {
      reasoning: thinkingMatch ? thinkingMatch.replace('Thinking', '').trim() : '',
      content: responseMatch ? responseMatch.replace('Response', '').trim() : ''
    }
  }
}

const thinkTagProcessor: ThoughtProcessor = {
  canProcess: (content: string, message?: Message) => {
    if (!message) return false

    return content.startsWith('<think>') || content.includes('</think>')
  },
  process: (content: string) => {
    // 处理正常闭合的 think 标签
    const thinkPattern = /^<think>(.*?)<\/think>/s
    const matches = content.match(thinkPattern)
    if (matches) {
      return {
        reasoning: matches[1].trim(),
        content: content.replace(thinkPattern, '').trim()
      }
    }

    // 处理只有结束标签的情况
    if (content.includes('</think>') && !content.startsWith('<think>')) {
      const parts = content.split('</think>')
      return {
        reasoning: parts[0].trim(),
        content: parts.slice(1).join('</think>').trim()
      }
    }

    // 处理只有开始标签的情况
    if (content.startsWith('<think>')) {
      return {
        reasoning: content.slice(7).trim(), // 跳过 '<think>' 标签
        content: ''
      }
    }

    return {
      reasoning: '',
      content
    }
  }
}

export function withMessageThought(message: Message): Message {
  return message
  // const originalContent = getMessageContent(message).trim()

  // if (message.role !== 'assistant') {
  //   return message
  // }

  // const model = message.model
  // if (!model || !isReasoningModel(model)) return message

  // const isClaude37Sonnet = model.id.includes('claude-3-7-sonnet') || model.id.includes('claude-3.7-sonnet')
  // if (isClaude37Sonnet) {
  //   const assistant = getAssistantById(message.assistantId)
  //   if (!assistant?.settings?.reasoning_effort) return message
  // }
  // const processors: ThoughtProcessor[] = [glmZeroPreviewProcessor, thinkTagProcessor]
  // const processor = processors.find((p) => p.canProcess(originalContent, message))

  // if (processor) {
  //   const { reasoning, content: processedContent } = processor.process(originalContent)

  //   const thinkingBlock = createThinkingBlock(message.id, reasoning, {
  //     status: MessageBlockStatus.SUCCESS
  //   })

  //   return { reasoning: reasoning || undefined, content: processedContent }
  // }

  // return { content: originalContent }
}

export function withGenerateImage(message: Message): { content: string; images?: string[] } {
  const originalContent = getMessageContent(message)
  const imagePattern = new RegExp(`!\\[[^\\]]*\\]\\((.*?)\\s*("(?:.*[^"])")?\\s*\\)`)
  const images: string[] = []
  let processedContent = originalContent

  processedContent = originalContent.replace(imagePattern, (match, url) => {
    if (url) {
      images.push(url)
    }
    return ''
  })

  processedContent = processedContent.replace(/\n\s*\n/g, '\n').trim()

  const downloadPattern = /\[[^\]]*\]\((.*?)\s*("(?:.*[^"])")?\s*\)/g
  processedContent = processedContent
    .replace(downloadPattern, '')
    .replace(/\n\s*\n/g, '\n')
    .trim()

  if (images.length > 0) {
    return { content: processedContent, images }
  }

  return { content: originalContent }
}

export function addImageFileToContents(messages: Message[]) {
  const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')
  if (!lastAssistantMessage) return messages
  const blocks = findImageBlocks(lastAssistantMessage)
  if (!blocks || blocks.length === 0) return messages
  if (blocks.every((v) => !v.metadata?.generateImage)) {
    return messages
  }

  const imageFiles = blocks.map((v) => v.metadata?.generateImage?.images).flat()
  const updatedAssistantMessage = {
    ...lastAssistantMessage,
    images: imageFiles
  }

  return messages.map((message) => (message.role === 'assistant' ? updatedAssistantMessage : message))
}
