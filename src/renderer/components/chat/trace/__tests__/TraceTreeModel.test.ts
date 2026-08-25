import type { SpanEntity } from '@shared/data/types/trace'
import { describe, expect, it } from 'vitest'

import { TraceTreeModel } from '../TraceTreeModel'

function span(
  id: string,
  parentId: string | null = null,
  startTime = 0,
  overrides: Partial<SpanEntity> = {}
): SpanEntity {
  return {
    id,
    traceId: 'trace-1',
    parentId,
    name: id,
    status: 'OK',
    startTime,
    endTime: startTime + 1,
    attributes: {},
    events: [],
    links: [],
    ...overrides
  } as SpanEntity
}

function visible(model: TraceTreeModel) {
  return model.visibleRows.map(({ id, depth, rootId }) => ({ id, depth, rootId }))
}

describe('TraceTreeModel', () => {
  it('handles empty and single-node snapshots', () => {
    const model = new TraceTreeModel()

    model.reset([])
    expect(model.nodeCount).toBe(0)
    expect(model.visibleRows).toEqual([])
    expect(model.isIdle).toBe(true)

    model.reset([span('root')])
    expect(visible(model)).toEqual([{ id: 'root', depth: 0, rootId: 'root' }])
  })

  it('flattens only expanded nodes in start-time order', () => {
    const model = new TraceTreeModel()
    model.reset([
      span('child-b', 'root', 30),
      span('root', null, 10),
      span('grandchild', 'child-a', 25),
      span('child-a', 'root', 20)
    ])

    expect(visible(model)).toEqual([
      { id: 'root', depth: 0, rootId: 'root' },
      { id: 'child-a', depth: 1, rootId: 'root' },
      { id: 'grandchild', depth: 2, rootId: 'root' },
      { id: 'child-b', depth: 1, rootId: 'root' }
    ])

    model.toggle('child-a')
    expect(model.visibleRows.map((row) => row.id)).toEqual(['root', 'child-a', 'child-b'])
    expect(model.getNode('grandchild')?.name).toBe('grandchild')

    model.toggle('child-a')
    expect(model.visibleRows.map((row) => row.id)).toEqual(['root', 'child-a', 'grandchild', 'child-b'])
  })

  it('inserts a new child without rebuilding existing visible rows', () => {
    const model = new TraceTreeModel()
    model.reset([span('root', null, 0), span('later', 'root', 20)])
    const visibleRows = model.visibleRows
    const rootRow = model.visibleRows[0]

    const mutation = model.applySpanChanges([span('middle', 'root', 10)])

    expect(mutation).toMatchObject({ kind: 'incremental', structureChanged: true })
    expect(model.visibleRows).toBe(visibleRows)
    expect(model.visibleRows[0]).toBe(rootRow)
    expect(model.visibleRows.map((row) => row.id)).toEqual(['root', 'middle', 'later'])
  })

  it('preserves collapsed branches when the same trace receives a full reset', () => {
    const model = new TraceTreeModel()
    model.reset([span('root'), span('child', 'root', 1)])
    model.toggle('root')

    model.reset([span('root', null, 0, { name: 'updated root' }), span('child', 'root', 1)])

    expect(model.isExpanded('root')).toBe(false)
    expect(model.visibleRows.map((row) => row.id)).toEqual(['root'])
    expect(model.getNode('root')?.name).toBe('updated root')
  })

  it('updates span fields without changing the visible projection', () => {
    const model = new TraceTreeModel()
    model.reset([span('root', null, 0, { endTime: null })])
    const visibleRows = model.visibleRows

    const mutation = model.applySpanChanges([span('root', null, 0, { name: 'updated', status: 'ERROR' })])

    expect(mutation).toMatchObject({ structureChanged: false, previousVisibleCount: 1, visibleCount: 1 })
    expect(model.visibleRows).toBe(visibleRows)
    expect(model.getNode('root')).toMatchObject({ name: 'updated', status: 'ERROR' })
    expect(model.isIdle).toBe(true)
  })

  it('reparents an orphan when its parent arrives incrementally', () => {
    const model = new TraceTreeModel()
    model.reset([span('orphan', 'parent', 20)])
    expect(visible(model)).toEqual([{ id: 'orphan', depth: 0, rootId: 'orphan' }])

    model.applySpanChanges([span('parent', null, 10)])

    expect(visible(model)).toEqual([
      { id: 'parent', depth: 0, rootId: 'parent' },
      { id: 'orphan', depth: 1, rootId: 'parent' }
    ])
  })

  it('adopts a large orphan batch with one rebuilt projection', () => {
    const model = new TraceTreeModel()
    const orphans = Array.from({ length: 1_000 }, (_, index) => span(`orphan-${index}`, 'parent', index + 1))
    model.reset(orphans)

    model.applySpanChanges([span('parent')])

    expect(model.getNode('parent')?.childIds).toHaveLength(1_000)
    expect(model.visibleRows).toHaveLength(1_001)
    expect(model.visibleRows[0]).toMatchObject({ id: 'parent', depth: 0, rootId: 'parent' })
    expect(model.visibleRows.at(-1)).toMatchObject({ id: 'orphan-999', depth: 1, rootId: 'parent' })
  })

  it('moves a node when its parent or start time changes', () => {
    const model = new TraceTreeModel()
    model.reset([
      span('root-a'),
      span('root-b', null, 10),
      span('before', 'root-b', 2),
      span('child', 'root-a', 5),
      span('grandchild', 'child', 6),
      span('after', 'root-b', 30)
    ])

    model.applySpanChanges([span('child', 'root-b', 20)])
    expect(model.visibleRows.map((row) => row.id)).toEqual([
      'root-a',
      'root-b',
      'before',
      'child',
      'grandchild',
      'after'
    ])
    expect(model.visibleRows[3]).toMatchObject({ depth: 1, rootId: 'root-b' })

    model.applySpanChanges([span('child', 'root-b', 1)])
    expect(model.getNode('root-b')?.childIds).toEqual(['child', 'before', 'after'])
    expect(model.visibleRows.map((row) => row.id)).toEqual([
      'root-a',
      'root-b',
      'child',
      'grandchild',
      'before',
      'after'
    ])
  })

  it('handles a deeply nested tree without recursive traversal', () => {
    const spans = Array.from({ length: 2_000 }, (_, index) =>
      span(`span-${index}`, index ? `span-${index - 1}` : null, index)
    )
    const model = new TraceTreeModel()

    model.reset(spans)

    expect(model.visibleRows).toHaveLength(2_000)
    expect(model.visibleRows.at(-1)).toMatchObject({ id: 'span-1999', depth: 1_999, rootId: 'span-0' })
  })

  it('builds a 50,000-row sibling set while keeping a single flat projection', () => {
    const spans = [
      span('root'),
      ...Array.from({ length: 50_000 }, (_, index) => span(`child-${index}`, 'root', index + 1))
    ]
    const model = new TraceTreeModel()

    model.reset(spans)

    expect(model.nodeCount).toBe(50_001)
    expect(model.visibleRows).toHaveLength(50_001)
    model.toggle('root')
    expect(model.visibleRows).toHaveLength(1)
    model.toggle('root')
    expect(model.visibleRows).toHaveLength(50_001)
  })
})
