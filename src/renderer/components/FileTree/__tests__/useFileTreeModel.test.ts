import { describe, expect, it } from 'vitest'

import type { FileTreeNode } from '../types'
import { buildFileTreeModel } from '../useFileTreeModel'

const nodes: FileTreeNode[] = [
  {
    id: 'root',
    name: 'Root',
    kind: 'folder',
    path: 'root',
    children: [
      { id: 'a', name: 'A.md', kind: 'file', path: 'root/a.md' },
      {
        id: 'sub',
        name: 'Sub',
        kind: 'folder',
        path: 'root/sub',
        children: [{ id: 'b', name: 'B.md', kind: 'file', path: 'root/sub/b.md' }]
      }
    ]
  }
]

describe('useFileTreeModel', () => {
  it('prepares canonical paths through @pierre/trees', () => {
    const model = buildFileTreeModel(nodes)

    expect(model.paths).toEqual(['root/', 'root/a.md', 'root/sub/', 'root/sub/b.md'])
    expect(model.preparedInput.paths).toEqual(['root/', 'root/sub/', 'root/sub/b.md', 'root/a.md'])
  })

  it('keeps presorted input order when requested', () => {
    const model = buildFileTreeModel(nodes, { presorted: true })

    expect(model.preparedInput.paths).toEqual(model.paths)
  })
})
