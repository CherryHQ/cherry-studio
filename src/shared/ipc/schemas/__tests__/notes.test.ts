import type { NotesTreeNode } from '@shared/types/note'
import { describe, expect, it } from 'vitest'

import { notesRequestSchemas } from '../notes'

const searchSchema = notesRequestSchemas['notes.full_text.search'].input

function note(id: string, children?: NotesTreeNode[]): NotesTreeNode {
  return {
    id,
    name: id,
    type: 'folder',
    treePath: `/${id}`,
    externalPath: `/notes/${id}`,
    children,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z'
  }
}

function request(nodes: NotesTreeNode[]) {
  return { requestId: 'search', nodes, keyword: 'needle', options: {}, maxResults: 10 }
}

describe('notes full-text search schema', () => {
  it('rejects a recursively nested tree beyond the depth budget', () => {
    let root = note('depth-101')
    for (let depth = 100; depth >= 1; depth -= 1) {
      root = note(`depth-${depth}`, [root])
    }

    expect(searchSchema.safeParse(request([root])).success).toBe(false)
  })

  it('applies the node budget across nested children rather than only top-level entries', () => {
    const sharedLeaf = note('leaf')
    const roots = Array.from({ length: 11 }, (_, index) =>
      note(
        `root-${index}`,
        Array.from({ length: 10_000 }, () => sharedLeaf)
      )
    )

    expect(searchSchema.safeParse(request(roots)).success).toBe(false)
  })
})
