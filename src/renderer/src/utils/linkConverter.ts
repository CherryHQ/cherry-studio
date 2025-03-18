// Counter for numbering links
let linkCounter = 1
// Buffer to hold incomplete link fragments across chunks
let buffer = ''

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
 * Converts Markdown links in the text to numbered links based on the rules:
 * 1. ([host](url)) -> [cnt](url)
 * 2. [host](url) -> [cnt](url)
 * 3. [anytext except host](url) -> anytext[cnt](url)
 *
 * @param text The current chunk of text to process
 * @param resetCounter Whether to reset the counter and buffer
 * @param isZhipu Whether to use Zhipu format
 * @returns Processed text with complete links converted
 */
export function convertLinks(text: string, resetCounter = false, isZhipu = false): string {
  if (resetCounter) {
    linkCounter = 1
    buffer = ''
  }

  // Append the new text to the buffer
  buffer += text

  // Find the safe point - the position after which we might have incomplete patterns
  let safePoint = buffer.length
  if (isZhipu) {
    // Handle Zhipu mode - find safe point for [ref_N] patterns
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
        result += `[<sup>${linkCounter++}</sup>](${url})`
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

        if (isHost(linkText)) {
          result += `[<sup>${linkCounter++}</sup>](${url})`
        } else {
          result += `${linkText}[<sup>${linkCounter++}</sup>](${url})`
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
  let match

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
