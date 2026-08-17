/**
 * Tests for `DbService.withEffects`.
 *
 * Unlike `withWriteTx` (where better-sqlite3 itself rejects an async tx fn),
 * nothing engine-level backs the synchronous-fn contract here — effects publish
 * the moment the callback returns, so an async callback would publish (and
 * clear the collector) before its work ran. The contracts worth guarding:
 *   - a synchronous callback's effects publish after it returns;
 *   - a Promise-returning callback is rejected without publishing anything.
 */

import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DbService as DbServiceClass } from '../DbService'

const { notifyDataApiDataChange } = vi.hoisted(() => ({ notifyDataApiDataChange: vi.fn() }))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange }))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const { DbService } = await vi.importActual<{ DbService: typeof DbServiceClass }>('../DbService')
type DbServiceInstance = InstanceType<typeof DbService>

function bareDbService(ready: boolean): DbServiceInstance {
  const service = Object.create(DbService.prototype) as DbServiceInstance
  Object.defineProperty(service, 'isReady', { value: ready })
  return service
}

describe('withEffects', () => {
  beforeEach(() => notifyDataApiDataChange.mockClear())

  it('publishes collected effects once the callback returns', () => {
    const service = bareDbService(true)
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection', entityIds: ['topic-1'] }

    expect(
      service.withEffects((effects) => {
        effects.add(effect)
        return 'ok'
      })
    ).toBe('ok')
    expect(notifyDataApiDataChange).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('rejects an async callback without publishing', () => {
    const service = bareDbService(true)

    expect(() =>
      service.withEffects(async (effects) => {
        effects.add({ endpoint: '/topics/latest' })
      })
    ).toThrow(/must be synchronous/i)
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })
})
