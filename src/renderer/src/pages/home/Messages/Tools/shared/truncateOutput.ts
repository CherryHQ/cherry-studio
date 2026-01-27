/**
 * Truncate output string to prevent UI performance issues
 * Tries to truncate at a newline boundary to avoid cutting in the middle of a line
 */

const MAX_OUTPUT_LENGTH = 50000

/**
 * Count non-empty lines in a string
 */
export function countLines(output: string | undefined | null): number {
  if (!output) return 0
  return output.split('\n').filter((line) => line.trim()).length
}

export interface TruncateResult {
  data: string
  isTruncated: boolean
  originalLength: number
}

export function truncateOutput(
  output: string | undefined | null,
  maxLength: number = MAX_OUTPUT_LENGTH
): TruncateResult {
  if (!output) {
    return { data: '', isTruncated: false, originalLength: 0 }
  }

  const originalLength = output.length

  if (output.length <= maxLength) {
    return { data: output, isTruncated: false, originalLength }
  }

  // Truncate and try to find a newline boundary
  const truncated = output.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf('\n')

  // Only use newline boundary if it's reasonably close to maxLength (within 20%)
  const data = lastNewline > maxLength * 0.8 ? truncated.slice(0, lastNewline) : truncated

  return { data, isTruncated: true, originalLength }
}
