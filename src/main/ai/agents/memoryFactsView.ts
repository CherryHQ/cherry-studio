import type { MemoryFacts } from '@shared/ai/agentMemory'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { MEMORY_CONFLICT } from '@shared/ipc/errors/memory'

import { readMemoryFacts, updateMemoryFacts, type MemoryFiles } from './memoryFiles'

export const MEMORY_FACT_MAX_LINES = 200
export const MEMORY_FACT_MAX_BYTES = 25_000

/** Offsets count UTF-16 code units, but pages never split a Unicode code point. */
export function memoryFactsPage(facts: MemoryFacts, offset = 0) {
  const text = facts.content
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    (offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset] ?? ''))
  ) {
    throw new Error('Invalid memory offset; use nextOffset from the previous page')
  }
  let bytes = 0
  let lines = 0
  let end = offset
  for (const char of text.slice(offset)) {
    const size = Buffer.byteLength(char, 'utf8')
    if (bytes + size > MEMORY_FACT_MAX_BYTES || lines >= MEMORY_FACT_MAX_LINES) break
    bytes += size
    end += char.length
    if (char === '\n') lines++
  }
  return {
    ...facts,
    content: text.slice(offset, end),
    offset,
    totalLength: text.length,
    complete: offset === 0 && end === text.length,
    ...(end < text.length ? { nextOffset: end } : {})
  }
}

export function formatMemoryFactsPreview(content: string, modifiedAt: string | undefined, tool: string): string {
  const page = memoryFactsPage({ content, revision: '' })
  const time = modifiedAt
    ? `File modified: ${modifiedAt} (file write time, not fact confirmation time).`
    : 'File modification time: unknown.'
  return `${time}\n${page.complete ? 'Complete facts.' : `Partial facts: limited to ${MEMORY_FACT_MAX_LINES} lines or ${MEMORY_FACT_MAX_BYTES} UTF-8 bytes. Omitted facts are not deleted. Use ${tool} action=read from offset=0, then nextOffset with expectedRevision to continue. Never replace the file from this preview.`}\n${page.content}`
}

export async function readMemoryFactsPage(files: MemoryFiles, offset = 0, expectedRevision?: string) {
  const facts = await readMemoryFacts(files)
  if (offset > 0 && !expectedRevision) throw new Error('Continuation requires expectedRevision from the first page')
  assertRevision(facts, expectedRevision)
  return memoryFactsPage(facts, offset)
}

function assertRevision(facts: MemoryFacts, expectedRevision?: string) {
  if (expectedRevision !== undefined && facts.revision !== expectedRevision) {
    throw new IpcError(MEMORY_CONFLICT, 'MEMORY_CONFLICT: Memory changed. Restart reading from offset=0.')
  }
}

/** Oversized files require exact edits so a partial read cannot erase omitted facts. */
export async function replaceMemoryFactsFromTool(files: MemoryFiles, content: string, expectedRevision?: string) {
  const facts = await readMemoryFacts(files)
  assertRevision(facts, expectedRevision)
  if (!memoryFactsPage(facts).complete)
    throw new Error(
      'Memory exceeds the full-replacement limit. Use patch with oldText, newText and expectedRevision, or edit the complete file in Settings.'
    )
  return memoryFactsPage(await updateMemoryFacts(files, content, facts.revision))
}

export async function patchMemoryFacts(files: MemoryFiles, oldText: string, newText: string, expectedRevision: string) {
  const facts = await readMemoryFacts(files)
  assertRevision(facts, expectedRevision)
  const index = facts.content.indexOf(oldText)
  if (!oldText || index < 0 || facts.content.indexOf(oldText, index + 1) >= 0)
    throw new Error('oldText must match exactly once; read more context before patching')
  const content = facts.content.slice(0, index) + newText + facts.content.slice(index + oldText.length)
  return memoryFactsPage(await updateMemoryFacts(files, content, expectedRevision))
}
