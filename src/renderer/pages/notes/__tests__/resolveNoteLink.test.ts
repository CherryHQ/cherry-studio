import { describe, expect, it } from 'vitest'

import type { NotesTreeNode } from '@renderer/types/note'

import { resolveNoteLink } from '../resolveNoteLink'

const file = (treePath: string): NotesTreeNode => ({
  id: treePath,
  name: treePath,
  treePath,
  externalPath: `${treePath}.md`,
  type: 'file',
  createdAt: '',
  updatedAt: ''
})
const tree = [file('/T'), file('/dir/T'), file('/dir2/T'), file('/é')]
describe('resolveNoteLink', () => {
  it.each(['md', 'MD', 'Md'])('matches the actual extension case: %s', (extension) => {
    const node = { ...file('/T'), externalPath: `/vault/T.${extension}` }
    expect(resolveNoteLink([node], `T.${extension}`)).toEqual({ kind: 'resolved', nodeId: '/T' })
    for (const other of ['md', 'MD', 'Md'].filter((value) => value !== extension)) {
      expect(resolveNoteLink([node], `T.${other}`)).toEqual({ kind: 'resolved', nodeId: '/T' })
    }
    expect(resolveNoteLink([node], 'T')).toEqual({ kind: 'resolved', nodeId: '/T' })
  })
  it('only resolves an extensionless basename when it is unique', () => {
    const nodes = [file('/T'), { ...file('/T'), id: '/T.MD', externalPath: '/vault/T.MD' }]
    expect(resolveNoteLink(nodes, 'T')).toEqual({ kind: 'ambiguous' })
    expect(resolveNoteLink(nodes, 'T.md')).toEqual({ kind: 'ambiguous' })
    expect(resolveNoteLink(nodes, 'T.MD')).toEqual({ kind: 'ambiguous' })
  })
  it('requires a unique exact path or basename', () => {
    expect(resolveNoteLink(tree, 'T')).toEqual({ kind: 'ambiguous' })
    expect(resolveNoteLink(tree, 'dir/T.md')).toEqual({ kind: 'resolved', nodeId: '/dir/T' })
    expect(resolveNoteLink(tree, 'dir2/T')).toEqual({ kind: 'resolved', nodeId: '/dir2/T' })
    for (const target of ['missing', 't', 'e\u0301']) expect(resolveNoteLink(tree, target)).toEqual({ kind: 'missing' })
  })
  it.each(['', '../T', '/T', 'C:\\T', 'https://example.com', 'dir//T', 'T#heading', 'T\n'])(
    'rejects unsupported target %s',
    (target) => {
      expect(resolveNoteLink(tree, target)).toEqual({ kind: 'unsupported' })
    }
  )
})
