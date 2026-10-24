import { ClaudeCodeResultError } from '../runtime/claudeCode'

const SIZE = String.raw`\d+(?:\.\d+)? ?(?:bytes|B|KB|MB|GB|TB)`
const SMALL_SIZE = `(?:${SIZE}|less than 1KB)`
const TOTAL_SIZE = `${SIZE}(?: \\(${SMALL_SIZE} over it\\))?`
const LONG_ADVICE = [
  ' Reduce the input (large tool results or pasted content) or start a new session; this conversation cannot continue as is.',
  ' Double press esc to go back past the large content, or /clear to start a new conversation.'
]
const SHORT_ADVICE = [
  'Remove older images or compact the conversation.',
  'Run /compact, or double press esc to go back and remove attachments.'
]
const ABBREVIATED = new RegExp(`^Request too large \\(max ${SIZE}\\)\\.?$`)
const LONG = new RegExp(
  `^Request too large for the API's ${SIZE} request limit: this conversation is about ${TOTAL_SIZE}, and (?:none of it is images or documents that could be removed|only ${SMALL_SIZE} of it is images or documents that could be removed), so removing attachments or compacting cannot make it fit\\.$`
)
const SHORT = new RegExp(
  `^Request too large \\(max ${SIZE}(?:; ${SMALL_SIZE} of about ${TOTAL_SIZE} is images or documents)?\\)\\. Accumulated images and attachments in the conversation pushed the request over the limit\\. $`
)

/** Map the Claude Code compaction diagnostic to the composer recovery reason it enables. */
export function classifyClaudeCodeCompactionError(error: string): 'nothing_to_compact' | undefined {
  const diagnostic = error.trim()
  return diagnostic === 'too_few_groups' || diagnostic === 'Reactive compact: fewer than 2 groups, nothing to compact'
    ? 'nothing_to_compact'
    : undefined
}

/** Map a terminal Claude Code request-size failure to the composer recovery reason it enables. */
export function classifyClaudeCodeRequestSizeError(error: unknown): 'request_too_large' | undefined {
  const diagnostics =
    error instanceof ClaudeCodeResultError && Array.isArray(error.errors)
      ? error.errors
      : [typeof error === 'string' ? error : error instanceof Error ? error.message : undefined]
  const matches = diagnostics.some((diagnostic) => {
    if (typeof diagnostic !== 'string') return false
    const message = diagnostic.trim()
    if (ABBREVIATED.test(message) || LONG.test(message)) return true
    return (
      LONG_ADVICE.some((advice) => message.endsWith(advice) && LONG.test(message.slice(0, -advice.length))) ||
      SHORT_ADVICE.some((advice) => message.endsWith(advice) && SHORT.test(message.slice(0, -advice.length)))
    )
  })
  return matches ? 'request_too_large' : undefined
}
