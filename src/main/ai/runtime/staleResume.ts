/**
 * Native SDK reports a resume against a CLI-side conversation that no longer
 * exists (crash/restart wiped it, or the branch changed). Matches the
 * `No conversation found with session ID: …` line from issue #23421 so the
 * host can drop the stale token and start fresh instead of failing every
 * subsequent turn.
 *
 * Centralized here so SDK wording changes have a single place to update.
 */
export function isStaleResumeError(error: unknown): boolean {
  return extractErrorText(error).includes('No conversation found with session ID')
}

/**
 * Best-effort extraction of the dead CLI-side conversation id from a stale
 * resume error (`No conversation found with session ID: <id>`). Used to scope
 * invalidation to the failed conversation so healthy sibling branches keep
 * their resume identities (#23519 review).
 *
 * The capture excludes trailing delimiters (`)]}>` + backtick/quote) and a
 * leading `<`/`{` so wrapped messages like `... ID: abc)` or `... ID: <abc>`
 * still match the stored `abc`.
 */
export function extractStaleConversationId(error: unknown): string | undefined {
  const text = extractErrorText(error)
  const match = text.match(/No conversation found with session ID:\s*["'`[{([]?([^\s'"`()\]{}>]+)/)
  const id = match?.[1]?.trim().replace(/^[<{]+|[.,;:)\]}>`]+$/g, '')
  return id ? id : undefined
}

function extractErrorText(error: unknown, depth = 0): string {
  if (error == null) return ''
  if (typeof error === 'string') return error
  if (depth > 5) return ''
  if (error instanceof Error) {
    const parts: string[] = [error.message ?? '']
    const errors = (error as { errors?: unknown }).errors
    if (errors !== undefined) parts.push(stringifyUnknown(errors))
    parts.push(extractErrorText((error as { cause?: unknown }).cause, depth + 1))
    return parts.join('\n')
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts: string[] = []
    for (const key of ['message', 'errors', 'cause', 'error']) {
      if (record[key] !== undefined) {
        const value = record[key]
        parts.push(typeof value === 'string' ? value : extractErrorText(value, depth + 1))
      }
    }
    if (parts.length > 0) return parts.join('\n')
    return stringifyUnknown(error)
  }
  return String(error)
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value.map((item) => (typeof item === 'string' ? item : stringifyUnknown(item))).join('; ')
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
