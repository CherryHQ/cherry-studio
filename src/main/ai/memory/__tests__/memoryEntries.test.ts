import { describe, expect, it } from 'vitest'

import { type MemoryEntry, memorySourceKey, parseMemoryEntries, serializeMemoryEntries } from '../memoryEntries'

const entry: MemoryEntry = {
  schemaVersion: 1,
  id: 'entry-1',
  status: 'active',
  sources: [{ kind: 'chat', conversationId: 'topic-1', messageId: 'message-1', sourceVersion: 'v1' }],
  text: 'A fact',
  derivedFrom: []
}

describe('memory entry format', () => {
  it('preserves legacy Markdown and ordinary JSON fences exactly', () => {
    const text = '# Old memory\r\n```json\n{"status":"forgotten"}\n```\n'
    expect(serializeMemoryEntries(parseMemoryEntries(text))).toBe(text)
  })

  it.each(['active', 'expired', 'forgotten'] as const)('round trips %s with explicit unknown sources', (status) => {
    const value = { ...entry, status, sources: [], text: status === 'forgotten' ? '' : 'A fact' }
    expect(parseMemoryEntries(serializeMemoryEntries([value]))).toEqual([value])
  })

  it('does not let source versions change the suppression key', () => {
    expect(memorySourceKey(entry.sources[0])).toBe(memorySourceKey({ ...entry.sources[0], sourceVersion: 'v2' }))
  })

  it.each([
    (text: string) => text.replace(':v1', ':v2'),
    (text: string) => text.replace('"active"', '"unknown"'),
    (text: string) => text.replace('"active"', '"forgotten"'),
    (text: string) => text.slice(0, -3),
    (text: string) => text + text,
    (text: string) => text.replace('"schemaVersion":1', '"schemaVersion":2')
  ])('rejects damaged or unsupported structured content', (damage) => {
    expect(() => parseMemoryEntries(damage(serializeMemoryEntries([entry])))).toThrow()
  })
})
