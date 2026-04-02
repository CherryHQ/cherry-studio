import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProcessingRuntimeService } from '../FileProcessingRuntimeService'

describe('FileProcessingRuntimeService', () => {
  let service: FileProcessingRuntimeService

  beforeEach(async () => {
    service = new FileProcessingRuntimeService()
    await service._doInit()
  })

  afterEach(async () => {
    if (!service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    BaseService.resetInstances()
    vi.useRealTimers()
  })

  it('initializes task runtime and exposes task operations', () => {
    service.createTask('doc2x', 'task-1', {
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing' as const,
      createdAt: 1
    })

    expect(service.getTask('doc2x', 'task-1')).toEqual({
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing',
      createdAt: 1
    })
  })

  it('clears task state on stop', async () => {
    service.createTask('open-mineru', 'task-2', {
      status: 'processing' as const,
      progress: 10
    })

    await service._doStop()
    expect((service as any).taskRuntime).toBeNull()
  })

  it('throws when accessed after stop', async () => {
    await service._doStop()

    expect(() => service.getTask('doc2x', 'task-1')).toThrow('FileProcessingRuntimeService is not initialized')
  })
})
