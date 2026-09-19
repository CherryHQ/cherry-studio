import { describe, expect, it } from 'vitest'

import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'

import { freshModelHealth, MODEL_HEALTH_STALE_AFTER_MS } from '../modelHealth'

describe('freshModelHealth', () => {
  const now = 1_000_000_000_000

  it('returns undefined when there is no record, so callers cannot mistake absence for a probe', () => {
    expect(freshModelHealth(undefined, now)).toBeUndefined()
  })

  it('returns a failure recorded moments ago', () => {
    const record: ModelHealthMemory[string] = { ok: false, checkedAt: now - 1_000 }
    expect(freshModelHealth(record, now)).toBe(record)
  })

  it('drops a failure once it is older than the staleness window, same as no record', () => {
    const record: ModelHealthMemory[string] = { ok: false, checkedAt: now - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    expect(freshModelHealth(record, now)).toBeUndefined()
  })

  it('drops an old success too, since an old ok is not evidence about right now either', () => {
    const record: ModelHealthMemory[string] = { ok: true, checkedAt: now - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    expect(freshModelHealth(record, now)).toBeUndefined()
  })

  it('treats the exact window boundary as stale', () => {
    const record: ModelHealthMemory[string] = { ok: true, checkedAt: now - MODEL_HEALTH_STALE_AFTER_MS }
    expect(freshModelHealth(record, now)).toBeUndefined()
  })

  it('treats one millisecond inside the boundary as fresh', () => {
    const record: ModelHealthMemory[string] = { ok: true, checkedAt: now - MODEL_HEALTH_STALE_AFTER_MS + 1 }
    expect(freshModelHealth(record, now)).toBe(record)
  })
})
