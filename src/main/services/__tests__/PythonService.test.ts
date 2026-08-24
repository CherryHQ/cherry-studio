import { BaseService } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WindowManager: {
      getWindowsByType: vi.fn(() => [{}]),
      broadcastToType: vi.fn()
    }
  })
})

import { application } from '@application'

import { PythonService } from '../PythonService'

const broadcastSpy = () => application.get('WindowManager').broadcastToType as ReturnType<typeof vi.fn>

describe('PythonService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    broadcastSpy().mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should broadcast a cancel to the renderer when a request times out', async () => {
    const service = new PythonService()

    const pending = service.executeScript('print(1)', {}, 1000)
    const assertion = expect(pending).rejects.toThrow('Python execution timed out')

    const requestCall = broadcastSpy().mock.calls.find((call) => call[1] === IpcChannel.Python_ExecutionRequest)
    expect(requestCall).toBeDefined()
    const requestId = requestCall![2].id

    await vi.advanceTimersByTimeAsync(6001)
    await assertion

    const cancelCall = broadcastSpy().mock.calls.find((call) => call[1] === IpcChannel.Python_ExecutionCancel)
    expect(cancelCall?.[2]).toBe(requestId)
  })

  it('should still reject the caller when the cancel broadcast throws', async () => {
    const service = new PythonService()
    broadcastSpy().mockImplementation((_windowType: unknown, channel: IpcChannel) => {
      if (channel === IpcChannel.Python_ExecutionCancel) {
        throw new Error('window destroyed')
      }
    })

    const pending = service.executeScript('print(1)', {}, 1000)
    const assertion = expect(pending).rejects.toThrow('Python execution timed out')

    await vi.advanceTimersByTimeAsync(6001)
    await assertion
  })
})
