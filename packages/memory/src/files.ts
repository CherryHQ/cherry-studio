export const MEMORY_ENTRY = 'MEMORY.md'
export const MEMORY_TOPICS = '.memories'
export const MEMORY_MAX_BYTES = 25_000
export const MEMORY_MAX_LINES = 200
export const MEMORY_WARNING_BYTES = 20_000
export const MEMORY_WARNING_LINES = 160
export class MemoryError extends Error {
  constructor(
    readonly code: 'invalid-path' | 'conflict' | 'limit' | 'invalid-receipt' | 'backup-capacity' | 'invalid-backup',
    message: string
  ) {
    super(message)
    this.name = 'MemoryError'
  }
}

export function assertMemoryTarget(relative: string): void {
  if (relative === MEMORY_ENTRY) return
  const parts = relative.split('/')
  const name = parts[1]
  if (
    parts.length !== 2 ||
    parts[0] !== MEMORY_TOPICS ||
    !name ||
    name.startsWith('.') ||
    !name.endsWith('.md') ||
    /[\\<>:"|?*]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
  ) {
    throw new MemoryError('invalid-path', 'The target is not a managed memory file')
  }
}

export function memoryLineCount(content: string): number {
  if (!content) return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

export function assertMemoryContent(relative: string, content: string): void {
  if (
    utf8Length(content) > MEMORY_MAX_BYTES ||
    (relative === MEMORY_ENTRY && memoryLineCount(content) > MEMORY_MAX_LINES)
  ) {
    throw new MemoryError('limit', 'Memory content exceeds the entry or topic limit')
  }
}

export function memoryEntryPreview(content: string): { content: string; truncated: boolean } {
  let bytes = 0
  const completeLines: string[] = []
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const size = utf8Length(line)
    if (completeLines.length === MEMORY_MAX_LINES || bytes + size > MEMORY_MAX_BYTES) break
    completeLines.push(line)
    bytes += size
  }
  const preview = completeLines.join('')
  return { content: preview, truncated: preview !== content }
}

const encoder = new TextEncoder()

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}
