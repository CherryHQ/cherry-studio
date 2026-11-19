import diff from 'fast-diff'

export function candidateBytesFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  beforeBytes: Uint8Array
): Uint8Array | undefined {
  if (toolName === 'Write' || toolName === 'write')
    return typeof toolInput.content === 'string' ? new TextEncoder().encode(toolInput.content) : undefined
  if (toolName !== 'Edit' && toolName !== 'edit' && toolName !== 'MultiEdit') return undefined
  let value = Buffer.from(beforeBytes).toString('latin1')
  const edits = toolName === 'Edit' ? [toolInput] : toolInput.edits
  if (!Array.isArray(edits)) return undefined
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') return undefined
    const { old_string, new_string, oldText, newText, replace_all: replaceAll } = edit as Record<string, unknown>
    const oldString = old_string ?? oldText
    const newString = new_string ?? newText
    if (typeof oldString !== 'string' || !oldString || typeof newString !== 'string') return undefined
    const oldBytes = Buffer.from(oldString, 'utf8').toString('latin1')
    const newBytes = Buffer.from(newString, 'utf8').toString('latin1')
    const first = value.indexOf(oldBytes)
    if (first < 0 || (replaceAll !== true && value.indexOf(oldBytes, first + 1) >= 0)) return undefined
    value = replaceAll === true ? value.split(oldBytes).join(newBytes) : value.replace(oldBytes, () => newBytes)
  }
  return Buffer.from(value, 'latin1')
}

export function classifyDestructiveWrite(
  before: { exists: boolean; bytes: Uint8Array } | undefined,
  after: Uint8Array | undefined
): 'none' | 'empty' | 'large-deletion' | 'undecidable' {
  if (!before || !after) return 'undecidable'
  const oldText = Buffer.from(before.bytes).toString('latin1')
  const newText = Buffer.from(after).toString('latin1')
  if (!before.exists || before.bytes.length === 0) return 'none'
  if (after.length === 0) return 'empty'
  const deleted = diff(oldText, newText).reduce(
    (count, [operation, part]) => count + (operation === diff.DELETE ? part.length : 0),
    0
  )
  return deleted > Math.floor(before.bytes.length / 2) ? 'large-deletion' : 'none'
}
