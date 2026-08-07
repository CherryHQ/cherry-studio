import type { NotesTreeNode } from '@renderer/types/note'
import { describe, expect, it } from 'vitest'

import { flattenTreeToFiles } from '../NotesTreeService'

const node = (overrides: Partial<NotesTreeNode> & Pick<NotesTreeNode, 'id' | 'name' | 'type'>): NotesTreeNode => ({
  treePath: overrides.name,
  externalPath: `/notes/${overrides.name}`,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides
})

describe('flattenTreeToFiles', () => {
  it('returns file nodes in tree order while excluding folders and hints', () => {
    const first = node({ id: 'first', name: 'first.md', type: 'file' })
    const nested = node({ id: 'nested', name: 'nested.md', type: 'file' })
    const tree = [
      first,
      node({
        id: 'folder',
        name: 'folder',
        type: 'folder',
        children: [node({ id: 'hint', name: 'hint', type: 'hint' }), nested]
      })
    ]

    expect(flattenTreeToFiles(tree)).toEqual([first, nested])
  })
})
