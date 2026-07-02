import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TraceStorageService } from '../TraceStorageService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('TraceStorageService profile activation', () => {
  it('drains in-flight flushes then clears the in-memory span store on deactivate and activate', async () => {
    const svc = new TraceStorageService()
    const clear = vi.spyOn(svc['store'], 'clear')
    await svc.onProfileDeactivate()
    svc.onProfileActivate()
    expect(clear).toHaveBeenCalledTimes(2)
  })
})
