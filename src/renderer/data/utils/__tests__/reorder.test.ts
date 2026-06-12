import { describe, expect, it } from 'vitest'

import { computeMinimalMoves, reorderLocally } from '../reorder'

type Item = { id: string }

const mk = (ids: string[]): Item[] => ids.map((id) => ({ id }))

describe('reorderLocally', () => {
  it('throws when the list is empty', () => {
    expect(() => reorderLocally<Item>([], 'a', { position: 'first' })).toThrow(/target id "a" not found/)
  })

  it('is a no-op for a single-item list moved to {position: "first"}', () => {
    const input = mk(['a'])
    const result = reorderLocally(input, 'a', { position: 'first' })
    expect(result.map((i) => i.id)).toEqual(['a'])
  })

  it('moves middle to first → [B, A, C]', () => {
    const input = mk(['a', 'b', 'c'])
    const result = reorderLocally(input, 'b', { position: 'first' })
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves first to last → [B, C, A]', () => {
    const input = mk(['a', 'b', 'c'])
    const result = reorderLocally(input, 'a', { position: 'last' })
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('handles {before: id} anchor', () => {
    const input = mk(['a', 'b', 'c', 'd'])
    const result = reorderLocally(input, 'd', { before: 'b' })
    expect(result.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('handles {after: id} anchor', () => {
    const input = mk(['a', 'b', 'c', 'd'])
    const result = reorderLocally(input, 'a', { after: 'c' })
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a', 'd'])
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

  it('throws when an item would anchor on itself via {before}', () => {
    const input = mk(['a', 'b', 'c'])
    expect(() => reorderLocally(input, 'b', { before: 'b' })).toThrow(/cannot anchor item "b" before itself/)
  })

  it('throws when an item would anchor on itself via {after}', () => {
    const input = mk(['a', 'b', 'c'])
    expect(() => reorderLocally(input, 'b', { after: 'b' })).toThrow(/cannot anchor item "b" after itself/)
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

  it('emits a single move when swapping two adjacent items', () => {
    const current = mk(['a', 'b', 'c'])
    const next = mk(['b', 'a', 'c'])
    const moves = computeMinimalMoves(current, next)
    expect(moves).toHaveLength(1)
  })

  it('emits 2 moves when fully reversing a 3-item list', () => {
    const current = mk(['a', 'b', 'c'])
    const next = mk(['c', 'b', 'a'])
    const moves = computeMinimalMoves(current, next)
    expect(moves).toHaveLength(2)
  })

  it('emits 1 move when rotating the first item to the last slot', () => {
    const current = mk(['a', 'b', 'c', 'd'])
    const next = mk(['b', 'c', 'd', 'a'])
    const moves = computeMinimalMoves(current, next)
    expect(moves).toEqual([{ id: 'a', anchor: { after: 'd' } }])
  })

  it('emits 1 move when moving the last item to the first slot', () => {
    const current = mk(['a', 'b', 'c', 'd'])
    const next = mk(['d', 'a', 'b', 'c'])
    const moves = computeMinimalMoves(current, next)
    expect(moves).toEqual([{ id: 'd', anchor: { position: 'first' } }])
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

  it('produces moves that reconstruct newList when applied sequentially (case 1)', () => {
    const current = mk(['a', 'b', 'c', 'd', 'e'])
    const next = mk(['c', 'a', 'e', 'b', 'd'])
    const moves = computeMinimalMoves(current, next)

    let state = current
    for (const move of moves) {
      state = reorderLocally(state, move.id, move.anchor)
    }
    expect(state.map((i) => i.id)).toEqual(next.map((i) => i.id))
  })

  it('produces moves that reconstruct newList when applied sequentially (case 2)', () => {
    const current = mk(['a', 'b', 'c', 'd', 'e', 'f'])
    const next = mk(['f', 'd', 'a', 'c', 'e', 'b'])
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

    it('throws when an item lacks a string value at the idKey field', () => {
      // Bad item placed FIRST so `findIndex` scans it before reaching the
      // target. An idKey mismatch must surface as a clear error, not silently
      // return wrong indices.
      const items = [{ name: 'no-app-id' }, { appId: 'a' }, { appId: 'b' }] as Array<Record<string, unknown>>
      expect(() => reorderLocally(items, 'a', { position: 'last' }, 'appId')).toThrow(/idKey="appId"/)
    })
  })

  describe('computeMinimalMoves', () => {
    it('diffs by the configured idKey and returns id-labelled moves', () => {
      const curr = [{ appId: 'a' }, { appId: 'b' }, { appId: 'c' }]
      const next = [{ appId: 'c' }, { appId: 'a' }, { appId: 'b' }]
      const moves = computeMinimalMoves(curr, next, 'appId')
      expect(moves).toHaveLength(1)
      expect(moves[0].id).toBe('c')
      expect(moves[0].anchor).toEqual({ position: 'first' })
    })

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
