import { describe, expect, it } from 'vitest'

import { flattenTree } from '../flatten-tree'
import type { TreeNodeAdapter } from '../types'

interface Node {
  id: string
  children?: Node[]
}

const adapter: TreeNodeAdapter<Node> = {
  getId: (n) => n.id,
  getChildren: (n) => n.children
}

describe('flattenTree', () => {
  it('returns empty list for empty data', () => {
    expect(flattenTree([], adapter, new Set())).toEqual([])
  })

  it('flattens a single root node without children', () => {
    const result = flattenTree([{ id: 'a' }], adapter, new Set())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'a', depth: 0 })
  })

  it('skips children of unexpanded nodes', () => {
    const data: Node[] = [{ id: 'root', children: [{ id: 'child' }] }]
    const result = flattenTree(data, adapter, new Set())
    expect(result.map((r) => r.id)).toEqual(['root'])
  })

  it('includes children when parent is expanded', () => {
    const data: Node[] = [{ id: 'root', children: [{ id: 'child' }] }]
    const result = flattenTree(data, adapter, new Set(['root']))
    expect(result.map((r) => r.id)).toEqual(['root', 'child'])
    expect(result.map((r) => r.depth)).toEqual([0, 1])
  })

  it('walks 5 levels deep when fully expanded', () => {
    const deep: Node = {
      id: 'l0',
      children: [{ id: 'l1', children: [{ id: 'l2', children: [{ id: 'l3', children: [{ id: 'l4' }] }] }] }]
    }
    const expanded = new Set(['l0', 'l1', 'l2', 'l3'])
    const result = flattenTree([deep], adapter, expanded)
    expect(result.map((r) => r.id)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4'])
    expect(result.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4])
  })

  it('handles partial expansion across siblings', () => {
    const data: Node[] = [
      { id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'b', children: [{ id: 'b1' }] }
    ]
    const result = flattenTree(data, adapter, new Set(['a']))
    expect(result.map((r) => r.id)).toEqual(['a', 'a1', 'a2', 'b'])
  })

  it('mixes leaves and branches preserving input order', () => {
    const data: Node[] = [{ id: 'leaf1' }, { id: 'branch', children: [{ id: 'inner' }] }, { id: 'leaf2' }]
    const result = flattenTree(data, adapter, new Set(['branch']))
    expect(result.map((r) => r.id)).toEqual(['leaf1', 'branch', 'inner', 'leaf2'])
  })

  it('skips revisited ids to avoid recursive cycles', () => {
    const root: Node = { id: 'root' }
    root.children = [root]

    const result = flattenTree([root], adapter, new Set(['root']))

    expect(result.map((r) => r.id)).toEqual(['root'])
  })

  it('skips duplicate ids to keep flat rows and React keys unique', () => {
    const data: Node[] = [{ id: 'same' }, { id: 'same' }]

    const result = flattenTree(data, adapter, new Set(['same']))

    expect(result.map((r) => r.id)).toEqual(['same'])
  })
})
