import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TraceStorageService } from '../TraceStorageService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('TraceStorageService profile activation', () => {
  it('clears the in-memory span store on profile deactivate and activate', () => {
    const svc = new TraceStorageService()
    const clear = vi.spyOn(svc['store'], 'clear')
    svc.onProfileDeactivate()
    svc.onProfileActivate()
    expect(clear).toHaveBeenCalledTimes(2)
  })
})
