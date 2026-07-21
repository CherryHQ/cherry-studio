import { BaseService } from '@main/core/lifecycle'
import { DataApiService } from '@main/data/DataApiService'
import type { DataApiChangeBatch, DataApiChangeEnvelope } from '@shared/data/api/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const adapterMocks = vi.hoisted(() => ({
  publishChanges: vi.fn()
}))

vi.unmock('@main/data/DataApiService')
vi.mock('../api', () => ({
  apiHandlers: {},
  ApiServer: { initialize: vi.fn(() => ({})) },
  IpcAdapter: class {
    publishChanges = adapterMocks.publishChanges
  }
}))

describe('DataApiService change publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
  })

  it('delegates one committed batch to the IPC adapter', () => {
    type TestChange = DataApiChangeEnvelope<'test.projection', { id: string }>
    const wireBatch = {
      changes: [{ type: 'test.projection', payload: { id: 'item-1' } }]
    } satisfies { changes: TestChange[] }
    const batch = wireBatch as unknown as DataApiChangeBatch
    const service = new DataApiService()

    service.publishChanges(batch)

    expect(adapterMocks.publishChanges).toHaveBeenCalledOnce()
    expect(adapterMocks.publishChanges).toHaveBeenCalledWith(batch)
  })
})
