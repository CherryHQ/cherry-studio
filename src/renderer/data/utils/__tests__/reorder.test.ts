import { describe, expect, it } from 'vitest'

import { computeMinimalMoves, reorderLocally } from '../reorder'

type Item = { id: string }

const mk = (ids: string[]): Item[] => ids.map((id) => ({ id }))

describe('reorderLocally', () => {
  it('is a no-op for a single-item list moved to {position: "first"}', () => {
    const input = mk(['a'])
    const result = reorderLocally(input, 'a', { position: 'first' })
    expect(result.map((i) => i.id)).toEqual(['a'])
  })

  it.each([
    ['moves middle to first → [B, A, C]', ['a', 'b', 'c'], 'b', { position: 'first' }, ['b', 'a', 'c']],
    ['moves first to last → [B, C, A]', ['a', 'b', 'c'], 'a', { position: 'last' }, ['b', 'c', 'a']],
    ['handles {before: id} anchor', ['a', 'b', 'c', 'd'], 'd', { before: 'b' }, ['a', 'd', 'b', 'c']],
    ['handles {after: id} anchor', ['a', 'b', 'c', 'd'], 'a', { after: 'c' }, ['b', 'c', 'a', 'd']]
  ] as const)('%s', (_name, inputIds, id, anchor, expectedIds) => {
    const result = reorderLocally(mk([...inputIds]), id, anchor)
    expect(result.map((i) => i.id)).toEqual(expectedIds)
  })

  it('returns a same-length result when moving an item into its current position', () => {
    const input = mk(['a', 'b', 'c'])
    const result = reorderLocally(input, 'a', { position: 'first' })
    expect(result.length).toBe(input.length)
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('throws when the target id is missing', () => {
    const input = mk(['a', 'b', 'c'])
    expect(() => reorderLocally(input, 'zzz', { position: 'first' })).toThrow(/target id "zzz" not found/)
  })

  it('throws when the anchor id is missing', () => {
    const input = mk(['a', 'b', 'c'])
    expect(() => reorderLocally(input, 'a', { before: 'zzz' })).toThrow(/anchor id "zzz" not found/)
    expect(() => reorderLocally(input, 'a', { after: 'zzz' })).toThrow(/anchor id "zzz" not found/)
  })

  it.each([
    ['before', { before: 'b' }, /cannot anchor item "b" before itself/],
    ['after', { after: 'b' }, /cannot anchor item "b" after itself/]
  ] as const)('throws when an item would anchor on itself via {%s}', (_direction, anchor, expectedError) => {
    const input = mk(['a', 'b', 'c'])
    expect(() => reorderLocally(input, 'b', anchor)).toThrow(expectedError)
  })

  it('does not mutate the input array', () => {
    const input = mk(['a', 'b', 'c', 'd'])
    const snapshot = input.map((i) => i.id)
    reorderLocally(input, 'a', { position: 'last' })
    reorderLocally(input, 'c', { before: 'a' })
    reorderLocally(input, 'd', { after: 'a' })
    expect(input.map((i) => i.id)).toEqual(snapshot)
  })
})

describe('computeMinimalMoves', () => {
  it('returns [] for two empty lists', () => {
    expect(computeMinimalMoves<Item>([], [])).toEqual([])
  })

  it('returns [] for identical arrays', () => {
    const list = mk(['a', 'b', 'c', 'd'])
    expect(computeMinimalMoves(list, mk(['a', 'b', 'c', 'd']))).toEqual([])
  })

  it.each([
    ['swapping two adjacent items', ['a', 'b', 'c'], ['b', 'a', 'c'], 1],
    ['fully reversing a 3-item list', ['a', 'b', 'c'], ['c', 'b', 'a'], 2]
  ] as const)('emits the minimal move count when %s', (_name, currentIds, nextIds, expectedCount) => {
    const moves = computeMinimalMoves(mk([...currentIds]), mk([...nextIds]))
    expect(moves).toHaveLength(expectedCount)
  })

  it.each([
    [
      'rotating the first item to the last slot',
      ['a', 'b', 'c', 'd'],
      ['b', 'c', 'd', 'a'],
      [{ id: 'a', anchor: { after: 'd' } }]
    ],
    [
      'moving the last item to the first slot',
      ['a', 'b', 'c', 'd'],
      ['d', 'a', 'b', 'c'],
      [{ id: 'd', anchor: { position: 'first' } }]
    ]
  ] as const)('emits the exact move when %s', (_name, currentIds, nextIds, expectedMoves) => {
    const moves = computeMinimalMoves(mk([...currentIds]), mk([...nextIds]))
    expect(moves).toEqual(expectedMoves)
  })

  it('throws when the lists have different id sets', () => {
    const current = mk(['a', 'b', 'c'])
    const next = mk(['a', 'b', 'x'])
    expect(() => computeMinimalMoves(current, next)).toThrow(/not a permutation/)
  })

  it('throws when lengths differ', () => {
    const current = mk(['a', 'b', 'c'])
    const next = mk(['a', 'b'])
    expect(() => computeMinimalMoves(current, next)).toThrow(/not a permutation/)
  })

  it('throws when newList contains duplicate ids of currentList entries', () => {
    const current = mk(['a', 'b', 'c'])
    // Same length but duplicate id — not a true permutation.
    const next = [{ id: 'a' }, { id: 'a' }, { id: 'b' }]
    expect(() => computeMinimalMoves(current, next)).toThrow(/not a permutation/)
  })

  it.each([
    ['five-item permutation', ['a', 'b', 'c', 'd', 'e'], ['c', 'a', 'e', 'b', 'd']],
    ['six-item permutation', ['a', 'b', 'c', 'd', 'e', 'f'], ['f', 'd', 'a', 'c', 'e', 'b']]
  ] as const)('reconstructs a %s when moves are applied sequentially', (_name, currentIds, nextIds) => {
    const current = mk([...currentIds])
    const next = mk([...nextIds])
    const moves = computeMinimalMoves(current, next)

    let state = current
    for (const move of moves) {
      state = reorderLocally(state, move.id, move.anchor)
    }
    expect(state.map((i) => i.id)).toEqual(next.map((i) => i.id))
  })

  it('emits moves in ascending new-position order', () => {
    const current = mk(['a', 'b', 'c', 'd', 'e'])
    const next = mk(['c', 'a', 'e', 'b', 'd'])
    const moves = computeMinimalMoves(current, next)

    const positions = moves.map((m) => next.findIndex((item) => item.id === m.id))
    const sorted = [...positions].sort((a, b) => a - b)
    expect(positions).toEqual(sorted)
  })
})

describe('reorder utils with custom idKey', () => {
  describe('reorderLocally', () => {
    it('identifies items by the configured idKey (e.g. appId)', () => {
      const items = [
        { appId: 'a', name: 'A' },
        { appId: 'b', name: 'B' },
        { appId: 'c', name: 'C' }
      ]
      const result = reorderLocally(items, 'c', { position: 'first' }, 'appId')
      expect(result.map((x) => x.appId)).toEqual(['c', 'a', 'b'])
    })

    it('resolves before/after anchors against the configured idKey', () => {
      const items = [{ appId: 'a' }, { appId: 'b' }, { appId: 'c' }]
      const result = reorderLocally(items, 'a', { after: 'c' }, 'appId')
      expect(result.map((x) => x.appId)).toEqual(['b', 'c', 'a'])
    })

    it.each([
      ['missing', { name: 'no-app-id' }],
      ['empty', { appId: '' }]
    ])('throws when an item has a %s idKey value', (_kind, invalidItem) => {
      // The invalid item is first so lookup must validate it before reaching the target.
      const items: Array<Record<string, unknown>> = [invalidItem, { appId: 'a' }, { appId: 'b' }]
      expect(() => reorderLocally(items, 'a', { position: 'last' }, 'appId')).toThrow(/idKey="appId"/)
    })
  })

  describe('computeMinimalMoves', () => {
    it('produces moves whose ids read from idKey and transform curr into next', () => {
      const curr = [{ appId: 'x' }, { appId: 'y' }]
      const next = [{ appId: 'y' }, { appId: 'x' }]
      const moves = computeMinimalMoves(curr, next, 'appId')
      // Which specific id ends up in `moves` depends on the LIS tie-break — any
      // valid minimal-move output is acceptable. The binding contract is that
      // (a) all move ids are valid idKey values and (b) applying the moves
      // sequentially transforms curr into next.
      expect(moves.length).toBe(1)
      expect(['x', 'y']).toContain(moves[0].id)
      const applied = reorderLocally(curr, moves[0].id, moves[0].anchor, 'appId')
      expect(applied.map((r) => r.appId)).toEqual(['y', 'x'])
    })
  })
})
