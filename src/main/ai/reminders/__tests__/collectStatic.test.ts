import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReminderBlock, StaticReminderSource } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

const make = (returns: ReminderBlock | null | Error): StaticReminderSource =>
  vi.fn(async () => {
    if (returns instanceof Error) throw returns
    return returns
  })

async function loadCollect(sources: StaticReminderSource[]) {
  vi.doMock('../sources/agentsMdSource', () => ({ agentsMdSource: vi.fn(async () => null) }))
  vi.doMock('../sources/registry', () => ({ STATIC_REMINDER_SOURCES: sources }))
  const mod = await import('../collectStatic')
  return mod.collectStaticReminders
}

describe('collectStaticReminders', () => {
  /**
   * Filtering + ordering. Source #1 returns null (its file isn't
   * present), source #2 contributes a block, source #3 contributes
   * another. The output must be a clean array of just #2 and #3, in
   * that order. A regression that drops nulls but reorders, or that
   * keeps nulls in the array, breaks the downstream rendering.
   */
  it('filters out null returns and preserves source order', async () => {
    const sources: StaticReminderSource[] = [
      make(null),
      make({ name: 'b', content: 'B body' }),
      make({ name: 'c', content: 'C body' })
    ]
    const collect = await loadCollect(sources)
    const out = await collect({ workspaceRoot: '/repo' })
    expect(out).toEqual([
      { name: 'b', content: 'B body' },
      { name: 'c', content: 'C body' }
    ])
  })

  /**
   * Resilience contract — the spec explicitly says a throwing source
   * must not abort the others. Without a test, the first refactor
   * that drops the per-source try/catch (thinking it's defensive
   * cruft) silently breaks every reminder downstream of the failing
   * source. Pin the intent.
   */
  it('drops a throwing source and lets the others contribute', async () => {
    const sources: StaticReminderSource[] = [
      make({ name: 'ok-1', content: 'one' }),
      make(new Error('boom')),
      make({ name: 'ok-2', content: 'two' })
    ]
    const collect = await loadCollect(sources)
    const out = await collect({ workspaceRoot: '/repo' })
    expect(out.map((b) => b.name)).toEqual(['ok-1', 'ok-2'])
  })
})
