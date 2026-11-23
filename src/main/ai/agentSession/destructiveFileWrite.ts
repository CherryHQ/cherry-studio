import diff from 'fast-diff'

const MAX_DIFF_REMAINDER = 4096

export function candidateBytesFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  beforeBytes: Uint8Array,
  runtime?: 'pi' | 'pi-durable'
): Uint8Array | undefined {
  if (toolName === 'Write' || toolName === 'write')
    return typeof toolInput.content === 'string' ? new TextEncoder().encode(toolInput.content) : undefined
  if (toolName === 'edit') {
    const original = Buffer.from(beforeBytes).toString('utf8')
    const normalize = (text: string) => text.replace(/\r\n|\r/g, '\n')
    const bom = runtime === 'pi-durable' && original.startsWith('\uFEFF') ? '\uFEFF' : ''
    const content = bom ? original.slice(1) : original
    const normalized = normalize(content)
    if (!Array.isArray(toolInput.edits)) return undefined
    const replacements: { start: number; end: number; text: string }[] = []
    for (const edit of toolInput.edits) {
      if (!edit || typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string')
        return undefined
      const old = normalize(edit.oldText)
      const start = normalized.indexOf(old)
      if (start < 0 || normalized.indexOf(old, start + 1) >= 0) return undefined
      replacements.push({ start, end: start + old.length, text: normalize(edit.newText) })
    }
    replacements.sort((a, b) => a.start - b.start)
    if (replacements.some((item, i) => i > 0 && replacements[i - 1].end > item.start)) return undefined
    if (runtime === 'pi-durable') {
      const crlfIdx = content.indexOf('\r\n')
      const lfIdx = content.indexOf('\n')
      const ending = lfIdx !== -1 && crlfIdx !== -1 && crlfIdx < lfIdx ? '\r\n' : '\n'
      let result = normalized
      for (const replacement of replacements.toReversed())
        result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
      return Buffer.from(bom + (ending === '\r\n' ? result.replace(/\n/g, '\r\n') : result), 'utf8')
    }
    let crlf = 0
    let next = original.indexOf('\r\n')
    const toOriginal = (index: number) => {
      while (next !== -1 && next - crlf < index) {
        crlf++
        next = original.indexOf('\r\n', next + 2)
      }
      return index + crlf
    }
    let position = 0
    const parts: string[] = []
    const push = (part: string) => {
      if (!part) return
      if (parts.length && parts[parts.length - 1].endsWith('\r') && part.startsWith('\n')) parts.push('\n')
      parts.push(part)
    }
    for (const replacement of replacements) {
      const start = toOriginal(replacement.start)
      push(original.slice(position, start))
      let lf = original.indexOf('\n', start)
      if (lf === -1) lf = original.lastIndexOf('\n', start)
      const ending = lf === -1 ? (original.includes('\r') ? '\r' : '\n') : original[lf - 1] === '\r' ? '\r\n' : '\n'
      push(replacement.text.replaceAll('\n', ending))
      position = toOriginal(replacement.end)
    }
    push(original.slice(position))
    return Buffer.from(parts.join(''), 'utf8')
  }
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
  let start = 0
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++
  let oldEnd = oldText.length
  let newEnd = newText.length
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const oldRest = oldText.slice(start, oldEnd)
  const newRest = newText.slice(start, newEnd)
  if (oldRest.length - newRest.length > Math.floor(before.bytes.length / 2)) return 'large-deletion'
  if (!oldRest || newRest.includes(oldRest)) return 'none'
  if (oldRest.length + newRest.length > MAX_DIFF_REMAINDER) return 'undecidable'
  const deleted = diff(oldRest, newRest).reduce(
    (count, [operation, part]) => count + (operation === diff.DELETE ? part.length : 0),
    0
  )
  return deleted > Math.floor(before.bytes.length / 2) ? 'large-deletion' : 'none'
}
