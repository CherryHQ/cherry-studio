import { safeToString } from '@renderer/utils/error'

const MAX_OUTPUT_LENGTH = 50000

type TextOutputItem = { type: 'text'; text: string }

const isTextOutputItem = (value: unknown): value is TextOutputItem => {
  if (!value || typeof value !== 'object') return false
  return 'type' in value && value.type === 'text' && 'text' in value && typeof value.text === 'string'
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP content and tool-output arrays may mix text and other blocks; the text-item predicate validates each retained block.
const getTextItems = (value: unknown): TextOutputItem[] => {
  if (!Array.isArray(value)) return []
  return value.filter(isTextOutputItem)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool renderers pass extension-defined outputs; extract validated text blocks or serialize before line counting and truncation.
const toOutputText = (output: unknown): string => {
  if (output === undefined || output === null || output === '') return ''
  if (typeof output === 'string') return output

  try {
    const textItems =
      typeof output === 'object' && output !== null && 'content' in output
        ? getTextItems(output.content)
        : getTextItems(output)

    if (textItems.length > 0) {
      return textItems.map((item) => item.text).join('\n\n')
    }

    return JSON.stringify(output, null, 2) ?? ''
  } catch {
    return safeToString(output)
  }
}

/**
 * Count non-empty lines in a rendered tool output value.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Search and glob renderers pass raw tool results; toOutputText normalizes them before counting nonblank display lines.
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Shell, search, notebook and fetch renderers pass heterogeneous tool outputs; toOutputText supplies text before applying the display limit.
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
