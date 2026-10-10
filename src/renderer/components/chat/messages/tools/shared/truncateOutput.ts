const MAX_OUTPUT_LENGTH = 50000

type TextOutputItem = { type: 'text'; text: string }

const isTextOutputItem = (value: unknown): value is TextOutputItem => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TextOutputItem>
  return item.type === 'text' && typeof item.text === 'string'
}

const getTextItems = (value: unknown): TextOutputItem[] => {
  if (!Array.isArray(value)) return []
  return value.filter(isTextOutputItem)
}

const toOutputText = (output: unknown): string => {
  if (output === undefined || output === null || output === '') return ''
  if (typeof output === 'string') return output

  const textItems =
    typeof output === 'object' && output !== null && 'content' in output
      ? getTextItems((output as { content?: unknown }).content)
      : getTextItems(output)

  if (textItems.length > 0) {
    return textItems.map((item) => item.text).join('\n\n')
  }

  try {
    return JSON.stringify(output, null, 2) ?? ''
  } catch {
    return String(output)
  }
}

/**
 * Count non-empty lines in a rendered tool output value.
 */
export function countLines(output: unknown): number {
  const text = toOutputText(output)
  if (!text) return 0
  return text.split('\n').filter((line) => line.trim()).length
}

export interface TruncateResult {
  data: string
  isTruncated: boolean
  originalLength: number
}

export function truncateOutput(output: unknown, maxLength: number = MAX_OUTPUT_LENGTH): TruncateResult {
  const text = toOutputText(output)

  if (!text) {
    return { data: '', isTruncated: false, originalLength: 0 }
  }

  const originalLength = text.length

  if (text.length <= maxLength) {
    return { data: text, isTruncated: false, originalLength }
  }

  // Truncate and try to find a newline boundary
  const truncated = text.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf('\n')

  // Only use newline boundary if it's reasonably close to maxLength (within 20%)
  const data = lastNewline > maxLength * 0.8 ? truncated.slice(0, lastNewline) : truncated

  return { data, isTruncated: true, originalLength }
}
