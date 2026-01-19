const CARET_BLOCK_DELIMITER = '^^'

export function decodeBase64Utf8(input: string): string | null {
  try {
    // Node 环境（Vitest）优先
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'base64').toString('utf-8')
    }

    // 浏览器环境
    if (typeof atob !== 'undefined') {
      const binary = atob(input)
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }

    return null
  } catch {
    return null
  }
}

export function encodeBase64Utf8(input: string): string {
  // Node 环境（Vitest）优先
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64')
  }

  // 浏览器环境
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function buildCaretBlock(content: string): string {
  return `${CARET_BLOCK_DELIMITER}\n${content}\n${CARET_BLOCK_DELIMITER}`
}

export function replaceCaretBlocksForHtml(markdown: string): string {
  if (!markdown) return ''

  const lines = markdown.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() !== CARET_BLOCK_DELIMITER) {
      out.push(line)
      continue
    }

    const contentLines: string[] = []
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== CARET_BLOCK_DELIMITER) {
      contentLines.push(lines[j])
      j += 1
    }

    if (j >= lines.length) {
      out.push(line)
      continue
    }

    const content = contentLines.join('\n')
    const encoded = encodeBase64Utf8(content)
    out.push(`<cs-compare-block data-content="${encoded}" data-collapsed="1"></cs-compare-block>`)
    i = j
  }

  return out.join('\n')
}
