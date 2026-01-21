/**
 * Utilities for truncating tool output to prevent UI performance issues
 */

const MAX_OUTPUT_LENGTH = 50000

/**
 * Truncate a string output to a maximum length
 * Tries to truncate at a newline boundary to avoid cutting in the middle of a line
 */
export function truncateOutput(
  output: string | undefined | null,
  maxLength: number = MAX_OUTPUT_LENGTH
): { text: string; isTruncated: boolean; originalLength: number } {
  if (!output) return { text: '', isTruncated: false, originalLength: 0 }

  const originalLength = output.length

  if (output.length <= maxLength) {
    return { text: output, isTruncated: false, originalLength }
  }

  // Truncate and try to find a newline boundary
  const truncated = output.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf('\n')

  // Only use newline boundary if it's reasonably close to maxLength (within 20%)
  const finalText = lastNewline > maxLength * 0.8 ? truncated.slice(0, lastNewline) : truncated

  return {
    text: finalText,
    isTruncated: true,
    originalLength
  }
}

/**
 * Truncate an array of text outputs (e.g., TaskTool's TextOutput[])
 * Stops adding items once the total length exceeds maxLength
 */
export function truncateTextOutputArray<T extends { text: string }>(
  outputs: T[] | undefined | null,
  maxLength: number = MAX_OUTPUT_LENGTH
): { outputs: T[]; isTruncated: boolean; originalLength: number } {
  if (!outputs || outputs.length === 0) {
    return { outputs: [], isTruncated: false, originalLength: 0 }
  }

  let totalLength = 0
  const originalLength = outputs.reduce((sum, item) => sum + item.text.length, 0)

  if (originalLength <= maxLength) {
    return { outputs, isTruncated: false, originalLength }
  }

  const result: T[] = []
  let isTruncated = false

  for (const item of outputs) {
    if (totalLength + item.text.length > maxLength) {
      const remaining = maxLength - totalLength
      // Only include partial item if there's meaningful space left
      if (remaining > 100) {
        result.push({
          ...item,
          text: item.text.slice(0, remaining)
        })
      }
      isTruncated = true
      break
    }
    result.push(item)
    totalLength += item.text.length
  }

  return { outputs: result, isTruncated, originalLength }
}

/**
 * Format byte size to human readable format
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
