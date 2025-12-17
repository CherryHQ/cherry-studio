// Counter for numbering links
let linkCounter = 1
// Buffer to hold incomplete link fragments across chunks
let buffer = ''
// Map to track URLs that have already been assigned numbers
let urlToCounterMap: Map<string, number> = new Map()

/**
 * Determines if a string looks like a host/URL
 * @param {string} text The text to check
 * @returns {boolean} Boolean indicating if the text is likely a host
 */
function isHost(text: string): boolean {
  // Basic check for URL-like patterns
  return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)
}

/**
 * Converts Markdown links in the text to numbered links based on the rules:
 * 1. ([host](url)) -> [cnt](url)
 * 2. [host](url) -> [cnt](url)
 * 3. [any text except url](url)-> any text [cnt](url)
 *
 * @param {string} text The current chunk of text to process
 * @param {boolean} resetCounter Whether to reset the counter and buffer
 * @returns {{text: string, hasBufferedContent: boolean}} Processed text and whether content was buffered
 */
export function convertLinks(
  text: string,
  resetCounter: boolean = false
): { text: string; hasBufferedContent: boolean } {
  if (resetCounter) {
    linkCounter = 1
    buffer = ''
    urlToCounterMap = new Map<string, number>()
  }

  // Append the new text to the buffer
  buffer += text

  // Find the safe point - the position after which we might have incomplete patterns
  let safePoint = buffer.length

  // Check for potentially incomplete patterns from the end
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i] === '(') {
      // Check if this could be the start of a parenthesized link
      if (i + 1 < buffer.length && buffer[i + 1] === '[') {
        // Verify if we have a complete parenthesized link
        const substring = buffer.substring(i)
        const match = /^\(\[([^\]]+)\]\(([^)]+)\)\)/.exec(substring)

        if (!match) {
          safePoint = i
          break
        }
      }
    } else if (buffer[i] === '[') {
      // Check if this could be the start of a regular link
      const substring = buffer.substring(i)

      // 检查是否是真正的不完整链接：[text]( 但没有完整的 url)
      const incompleteLink = /^\[([^\]]+)\]\s*\([^)]*$/.test(substring)
      if (incompleteLink) {
        safePoint = i
        break
      }

      // 检查是否是完整的链接
      const completeLink = /^\[([^\]]+)\]\(([^)]+)\)/.test(substring)
      if (completeLink) {
        // 如果是完整链接，继续处理，不设置safePoint
        continue
      }

      // 检查是否是不完整的 [ 开始但还没有闭合的 ]
      // 例如 [example. 这种情况
      const incompleteBracket = /^\[[^\]]*$/.test(substring)
      if (incompleteBracket) {
        safePoint = i
        break
      }

      // 如果不是潜在的链接格式，继续检查
    }
  }

  // Extract the part of the buffer that we can safely process
  const safeBuffer = buffer.substring(0, safePoint)
  buffer = buffer.substring(safePoint)

  // 检查是否有内容被保留在buffer中
  const hasBufferedContent = buffer.length > 0

  // Process the safe buffer to handle complete links
  let result = ''
  let position = 0

  while (position < safeBuffer.length) {
    // Check for parenthesized link pattern: ([text](url))
    if (position + 1 < safeBuffer.length && safeBuffer[position] === '(' && safeBuffer[position + 1] === '[') {
      const substring = safeBuffer.substring(position)
      const match = /^\(\[([^\]]+)\]\(([^)]+)\)\)/.exec(substring)

      if (match) {
        // Found complete parenthesized link
        const url = match[2]

        // Check if this URL has been seen before
        let counter: number
        if (urlToCounterMap.has(url)) {
          counter = urlToCounterMap.get(url)!
        } else {
          counter = linkCounter++
          urlToCounterMap.set(url, counter)
        }

        result += `[<sup>${counter}</sup>](${url})`
        position += match[0].length
        continue
      }
    }

    // Check for regular link pattern: [text](url)
    if (safeBuffer[position] === '[') {
      const substring = safeBuffer.substring(position)
      const match = /^\[([^\]]+)\]\(([^)]+)\)/.exec(substring)

      if (match) {
        // Found complete regular link
        const linkText = match[1]
        const url = match[2]

        // Check if this URL has been seen before
        let counter: number
        if (urlToCounterMap.has(url)) {
          counter = urlToCounterMap.get(url)!
        } else {
          counter = linkCounter++
          urlToCounterMap.set(url, counter)
        }

        // Rule 3: If the link text is not a URL/host, keep the text and add the numbered link
        // 增加一个条件：如果 linkText 是纯数字，也直接替换
        if (isHost(linkText) || /^\d+$/.test(linkText)) {
          // Rule 2: If the link text is a URL/host or purely digits, replace with numbered link
          result += `[<sup>${counter}</sup>](${url})`
        } else {
          // If the link text is neither a URL/host nor purely digits, keep the text and add the numbered link
          result += `${linkText} [<sup>${counter}</sup>](${url})`
        }

        position += match[0].length
        continue
      }
    }

    // If no pattern matches at this position, add the character and move on
    result += safeBuffer[position]
    position++
  }

  return {
    text: result,
    hasBufferedContent
  }
}

/**
 * 根据webSearch结果补全链接，将[<sup>num</sup>]()转换为[<sup>num</sup>](webSearch[num-1].url)
 * @param {string} text 原始文本
 * @param {any[]} webSearch webSearch结果
 * @returns {string} 补全后的文本
 */
export function completeLinks(text: string, webSearch: any[]): string {
  // 使用正则表达式匹配形如 [<sup>num</sup>]() 的链接
  return text.replace(/\[<sup>(\d+)<\/sup>\]\(\)/g, (match, num) => {
    const index = parseInt(num) - 1
    // 检查 webSearch 数组中是否存在对应的 URL
    if (index >= 0 && index < webSearch.length && webSearch[index]?.link) {
      return `[<sup>${num}</sup>](${webSearch[index].link})`
    }
    // 如果没有找到对应的 URL，保持原样
    return match
  })
}

/**
 * 从Markdown文本中提取所有URL
 * 支持以下格式：
 * 1. [text](url)
 * 2. [<sup>num</sup>](url)
 * 3. ([text](url))
 *
 * @param {string} text Markdown格式的文本
 * @returns {string[]} 提取到的URL数组，去重后的结果
 */
export function extractUrlsFromMarkdown(text: string): string[] {
  const urlSet = new Set<string>()

  // 匹配所有Markdown链接格式
  const linkPattern = /\[(?:[^[\]]*)\]\(([^()]+)\)/g
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[1].trim()
    if (isValidUrl(url)) {
      urlSet.add(url)
    }
  }

  return Array.from(urlSet)
}

/**
 * 验证字符串是否是有效的URL
 * @param {string} url 要验证的URL字符串
 * @returns {boolean} 是否是有效的URL
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 清理 Markdown 链接之间的逗号
 * 例如: [text](url),[text](url) -> [text](url) [text](url)
 * @param {string} text 包含 Markdown 链接的文本
 * @returns {string} 清理后的文本
 */
export function cleanLinkCommas(text: string): string {
  // 匹配两个 Markdown 链接之间的英文逗号（可能包含空格）
  return text.replace(/\]\(([^)]+)\)\s*,\s*\[/g, ']($1)[')
}

/**
 * 强制返回buffer中的所有内容，用于流结束时清空缓冲区
 * @returns {string} buffer中剩余的所有内容
 */
export function flushLinkConverterBuffer(): string {
  const remainingBuffer = buffer
  buffer = ''
  return remainingBuffer
}
