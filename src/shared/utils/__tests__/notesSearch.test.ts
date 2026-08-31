import { describe, expect, it } from 'vitest'

import { validateNotesSearchTree } from '../notesSearch'

interface TestNode {
  children?: TestNode[]
}

const parseNode = (value: unknown) =>
  value && typeof value === 'object'
    ? ({ success: true, data: value as TestNode } as const)
    : ({ success: false, error: { issues: [{ message: 'not a node', path: [] }] } } as const)

describe('validateNotesSearchTree', () => {
  it('rejects a recursively nested tree beyond the depth budget', () => {
    let root: TestNode = {}
    for (let depth = 0; depth < 4; depth += 1) root = { children: [root] }

    expect(validateNotesSearchTree([root], { maxDepth: 4, maxNodes: 100, parseNode }).issues).toEqual([
      expect.objectContaining({ message: 'Notes search tree exceeds depth 4' })
    ])
  })

  it('applies the node budget across nested children', () => {
    const root = { children: [{}, {}, {}] }

    expect(validateNotesSearchTree([root], { maxDepth: 10, maxNodes: 3, parseNode }).issues).toEqual([
      expect.objectContaining({ message: 'Notes search tree exceeds 3 total nodes' })
    ])
  })

  it('reports malformed nodes through the extracted predicate', () => {
    expect(validateNotesSearchTree([null], { maxDepth: 10, maxNodes: 10, parseNode }).issues).toEqual([
      { message: 'not a node', path: [0] }
    ])
  })
})
