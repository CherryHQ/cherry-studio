// Counter for numbering links
let linkCounter = 1
// Buffer to hold incomplete link fragments across chunks
let buffer = ''
// Map to track URLs that have already been assigned numbers
let urlToCounterMap: Map<string, number> = new Map()

/**
 * Determines if a string looks like a host/URL
 * @param text The text to check
 * @returns Boolean indicating if the text is likely a host
 */
function isHost(text: string): boolean {
  // Basic check for URL-like patterns
  return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)
}

/**
 * Converts Markdown links in the text to numbered links based on the rules:s
 * [ref_N] -> [<sup>N</sup>]
 * @param text The current chunk of text to process
 * @param resetCounter Whether to reset the counter and buffer
 * @returns Processed text with complete links converted
 */
export function convertLinksToZhipu(text: string, resetCounter = false): string {
  if (resetCounter) {
    linkCounter = 1
    buffer = ''
  }

  // Append the new text to the buffer
  buffer += text
  let safePoint = buffer.length

  // Check from the end for potentially incomplete [ref_N] patterns
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i] === '[') {
      const substring = buffer.substring(i)
      // Check if it's a complete [ref_N] pattern
      const match = /^\[ref_\d+\]/.exec(substring)

      if (!match) {
        // Potentially incomplete [ref_N] pattern
        safePoint = i
        break
      }
    }
  }

  // Process the safe part of the buffer
  const safeBuffer = buffer.substring(0, safePoint)
  buffer = buffer.substring(safePoint)

  // Replace all complete [ref_N] patterns
  return safeBuffer.replace(/\[ref_(\d+)\]/g, (_, num) => {
    return `[<sup>${num}</sup>]()`
  })
}

export function convertLinksToHunyuan(text: string, webSearch: any[], resetCounter = false): string {
  if (resetCounter) {
    linkCounter = 1
    buffer = ''
  }

  buffer += text
  let safePoint = buffer.length

  // Check from the end for potentially incomplete patterns
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i] === '[') {
      const substring = buffer.substring(i)
      // Check if it's a complete pattern - handles both [N](@ref) and [N,M,...](@ref)
      const match = /^\[[\d,\s]+\]\(@ref\)/.exec(substring)

      if (!match) {
        // Potentially incomplete pattern
        safePoint = i
        break
      }
    }
  }

  // Process the safe part of the buffer
  const safeBuffer = buffer.substring(0, safePoint)
  buffer = buffer.substring(safePoint)

  // Replace all complete patterns
  return safeBuffer.replace(/\[([\d,\s]+)\]\(@ref\)/g, (_, numbers) => {
    // Split the numbers string into individual numbers
    const numArray = numbers
      .split(',')
      .map((num) => parseInt(num.trim()))
      .filter((num) => !isNaN(num))

    // Generate separate superscript links for each number
    const links = numArray.map((num) => {
      const index = num - 1
      // Check if the index is valid in webSearch array
      if (index >= 0 && index < webSearch.length && webSearch[index]?.url) {
        return `[<sup>${num}</sup>](${webSearch[index].url})`
      }
      // If no matching URL found, keep the original reference format for this number
      return `[<sup>${num}</sup>](@ref)`
    })

    // Join the separate links with spaces
    return links.join('')
  })
}

/**
 * Converts Markdown links in the text to numbered links based on the rules:
 * 1. ([host](url)) -> [cnt](url)
 * 2. [host](url) -> [cnt](url)
 * 3. [any text except url](url)-> any text [cnt](url)
 *
 * @param text The current chunk of text to process
 * @param resetCounter Whether to reset the counter and buffer
 * @returns Processed text with complete links converted
 */
export function convertLinks(text: string, resetCounter = false): string {
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
      const match = /^\[([^\]]+)\]\(([^)]+)\)/.exec(substring)

      if (!match) {
        safePoint = i
        break
      }
    }
  }

  // Extract the part of the buffer that we can safely process
  const safeBuffer = buffer.substring(0, safePoint)
  buffer = buffer.substring(safePoint)

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
        if (!isHost(linkText)) {
          result += `${linkText} [<sup>${counter}</sup>](${url})`
        } else {
          // Rule 2: If the link text is a URL/host, replace with numbered link
          result += `[<sup>${counter}</sup>](${url})`
        }

        position += match[0].length
        continue
      }
    }

    // If no pattern matches at this position, add the character and move on
    result += safeBuffer[position]
    position++
  }

  return result
}

/**
 * Converts Markdown links in the text to numbered links based on the rules:
 * 1. [host](url) -> [cnt](url)
 *
 * @param text The current chunk of text to process
 * @param resetCounter Whether to reset the counter and buffer
 * @returns Processed text with complete links converted
 */
export function convertLinksToOpenRouter(text: string, resetCounter = false): string {
  if (resetCounter) {
    linkCounter = 1
    buffer = ''
    urlToCounterMap = new Map<string, number>()
  }

  // Append the new text to the buffer
  buffer += text

  // Find a safe point to process
  let safePoint = buffer.length

  // Check for potentially incomplete link patterns from the end
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i] === '[') {
      const substring = buffer.substring(i)
      const match = /^\[([^\]]+)\]\(([^)]+)\)/.exec(substring)

      if (!match) {
        safePoint = i
        break
      }
    }
  }

  // Extract the part of the buffer that we can safely process
  const safeBuffer = buffer.substring(0, safePoint)
  buffer = buffer.substring(safePoint)

  // Process the safe buffer to handle complete links
  const result = safeBuffer.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Only convert link if the text looks like a host/URL
    if (isHost(text)) {
      // Check if this URL has been seen before
      let counter: number
      if (urlToCounterMap.has(url)) {
        counter = urlToCounterMap.get(url)!
      } else {
        counter = linkCounter++
        urlToCounterMap.set(url, counter)
      }
      return `[<sup>${counter}</sup>](${url})`
    }
    // Keep original link format if the text doesn't look like a host
    return match
  })

  return result
}

/**
 * 根据webSearch结果补全链接，将[<sup>num</sup>]()转换为[<sup>num</sup>](webSearch[num-1].url)
 * @param text 原始文本
 * @param webSearch webSearch结果
 * @returns 补全后的文本
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
 * @param text Markdown格式的文本
 * @returns 提取到的URL数组，去重后的结果
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
 * @param url 要验证的URL字符串
 * @returns 是否是有效的URL
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
 * @param text 包含 Markdown 链接的文本
 * @returns 清理后的文本
 */
export function cleanLinkCommas(text: string): string {
  // 匹配两个 Markdown 链接之间的英文逗号（可能包含空格）
  return text.replace(/\]\(([^)]+)\)\s*,\s*\[/g, ']($1)[')
}
