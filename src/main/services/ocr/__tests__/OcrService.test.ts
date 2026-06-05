import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OcrService } from '../OcrService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('OcrService paddle async bridge', () => {
  it('delegates startTask to the paddle handler', async () => {
    const startTask = vi.fn().mockResolvedValue({
      taskId: 'paddle-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })

    const service = new OcrService()
    service.register('paddleocr', { startTask } as never)

    const result = await service.startTask(
      { path: '/tmp/a.png', type: 'image' } as never,
      { id: 'paddleocr', capabilities: { image: true } } as never
    )

    expect(startTask).toHaveBeenCalledWith({ path: '/tmp/a.png', type: 'image' }, undefined)
    expect(result.providerTaskId).toBe('paddle-1')
  })

  it('delegates getTaskStatus to the paddle handler', async () => {
    const getTaskStatus = vi.fn().mockResolvedValue({
      taskId: 'paddle-1',
      providerTaskId: 'paddle-1',
      status: 'processing',
      progress: 50
    })

    const service = new OcrService()
    service.register('paddleocr', { getTaskStatus } as never)

    const result = await service.getTaskStatus('paddle-1', { id: 'paddleocr', capabilities: { image: true } } as never)

    expect(getTaskStatus).toHaveBeenCalledWith('paddle-1', undefined)
    expect(result.status).toBe('processing')
  })

  it('delegates getTaskResult to the paddle handler', async () => {
    const getTaskResult = vi.fn().mockResolvedValue({
      taskId: 'paddle-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'recognized text',
        pages: [{ text: 'recognized text' }]
      }
    })

    const service = new OcrService()
    service.register('paddleocr', { getTaskResult } as never)

    const result = await service.getTaskResult('paddle-1', { id: 'paddleocr', capabilities: { image: true } } as never)

    expect(getTaskResult).toHaveBeenCalledWith('paddle-1', undefined)
    expect(result.result.text).toBe('recognized text')
  })
})
