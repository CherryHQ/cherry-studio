import { Message } from '@renderer/types'

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

export function withGeminiGrounding(message: Message) {
  const { groundingSupports } = message?.metadata?.groundingMetadata || {}

  if (!groundingSupports) {
    return message.content
  }

  let content = message.content

  groundingSupports.forEach((support) => {
    const text = support.segment.text
    const indices = support.groundingChunkIndices
    const nodes = indices.reduce((acc, index) => {
      acc.push(`<sup>${index + 1}</sup>`)
      return acc
    }, [])
    content = content.replace(text, `${text} ${nodes.join(' ')}`)
  })

  return content
}

interface ThoughtProcessor {
  canProcess: (content: string) => boolean
  process: (content: string) => { reasoning: string; content: string }
}

const glmZeroPreviewProcessor: ThoughtProcessor = {
  canProcess: (content: string) => content.includes('###Thinking'),
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
  canProcess: (content: string) => content.startsWith('<think>') || content.includes('</think>'),
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

export function withMessageThought(message: Message) {
  if (message.role !== 'assistant') {
    return message
  }

  const content = message.content.trim()
  const processors: ThoughtProcessor[] = [glmZeroPreviewProcessor, thinkTagProcessor]

  const processor = processors.find((p) => p.canProcess(content))
  if (processor) {
    const { reasoning, content: processedContent } = processor.process(content)
    message.reasoning_content = reasoning
    message.content = processedContent
  }

  return message
}
