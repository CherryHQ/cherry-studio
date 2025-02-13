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

export function withMessageThought(message: Message) {
  if (message.role !== 'assistant') {
    return message
  }

  const content = message.content.trim()
  const thinkPattern = /^<think>(.*?)<\/think>/s
  const matches = content.match(thinkPattern)

  if (!matches) {
    // 处理未闭合的 think 标签情况
    if (content.startsWith('<think>')) {
      message.reasoning_content = content.slice(7) // '<think>'.length === 7
      message.content = ''
    }
    return message
  }

  const reasoning_content = matches[1].trim()
  if (reasoning_content) {
    message.reasoning_content = reasoning_content
    message.content = content.replace(thinkPattern, '').trim()
  }

  return message
}

export function fixPunctuation(text: string): string {
  // 将网页链接后的中文标点符号与链接分开
  return text.replace(
    /(https?:\/\/[^\s)]+)(\p{P})/gu,
    `<a href="$1" target="_blank" rel="noreferrer">$1</a><span style="margin-left: 0.2em;">$2</span>`
  )
}
