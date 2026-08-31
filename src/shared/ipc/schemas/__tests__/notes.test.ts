import { describe, expect, it } from 'vitest'

import { notesRequestSchemas } from '../notes'

const searchInput = notesRequestSchemas['notes.full_text.search'].input
const node = {
  id: 'note-1',
  name: 'Note',
  type: 'file' as const,
  treePath: 'Note.md',
  externalPath: '/notes/Note.md',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z'
}

describe('notes search IPC schema', () => {
  it('validates a normal notes tree', () => {
    expect(
      searchInput.safeParse({ requestId: 'search-1', nodes: [node], keyword: 'note', options: {}, maxResults: 10 })
        .success
    ).toBe(true)
  })

  it('rejects a recursively nested tree beyond the depth budget without recursive parsing', () => {
    let root: Record<string, unknown> = { ...node, type: 'folder', children: [] }
    for (let depth = 0; depth < 101; depth += 1) {
      root = { ...node, id: `folder-${depth}`, type: 'folder', children: [root] }
    }

    const result = searchInput.safeParse({
      requestId: 'search-1',
      nodes: [root],
      keyword: 'note',
      options: {},
      maxResults: 10
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('exceeds depth 100')
  })

  it('reports malformed tree nodes at the IPC boundary', () => {
    const result = searchInput.safeParse({
      requestId: 'search-1',
      nodes: [null],
      keyword: 'note',
      options: {},
      maxResults: 10
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['nodes', 0])
  })
})
