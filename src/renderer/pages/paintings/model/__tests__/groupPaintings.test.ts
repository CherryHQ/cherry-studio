import { describe, expect, it } from 'vitest'

import { groupPaintings } from '../groupPaintings'
import type { PaintingData } from '../types/paintingData'

const p = (id: string, groupId?: string): PaintingData =>
  ({ id, providerId: 'x', mode: 'generate', prompt: '', files: [], groupId }) as PaintingData

describe('groupPaintings', () => {
  it('keeps ungrouped paintings as their own entries, in order', () => {
    expect(groupPaintings([p('a'), p('b')]).map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('folds paintings sharing a group_id into one entry at first-seen position', () => {
    const entries = groupPaintings([p('a', 'g1'), p('b'), p('c', 'g1')])
    expect(entries.map((e) => e.key)).toEqual(['group:g1', 'b'])
    expect(entries[0].paintings.map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('a group_id with a single member is still one entry', () => {
    const entries = groupPaintings([p('a', 'g1')])
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('group:g1')
    expect(entries[0].paintings.map((x) => x.id)).toEqual(['a'])
  })
})
