import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { deepSeekHarnessHandlers } from '../deepSeekHarness'

const service = {
  start: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn()
}
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'DeepSeekHarnessService') return service
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('deepSeekHarnessHandlers', () => {
  it('forwards only the validated start projection and returns its dynamic URL', async () => {
    const input = {
      mode: 'direct' as const,
      uniqueModelId: 'anthropic::claude-sonnet' as const,
      agentPreset: 'code' as const,
      permissionMode: 'read-only' as const
    }
    service.start.mockResolvedValue({ success: true, url: 'http://127.0.0.1:43123' })
    await expect(deepSeekHarnessHandlers['deepseek_harness.start'](input, ctx)).resolves.toEqual({
      success: true,
      url: 'http://127.0.0.1:43123'
    })
    expect(service.start).toHaveBeenCalledWith(input)
  })

  it('turns start and stop failures into renderer-safe results', async () => {
    service.start.mockRejectedValue(new Error('launch failed'))
    service.stop.mockRejectedValue(new Error('stop failed'))
    await expect(
      deepSeekHarnessHandlers['deepseek_harness.start'](
        {
          mode: 'gateway',
          uniqueModelId: 'openai::gpt-5',
          agentPreset: 'inherit',
          permissionMode: 'workspace-write'
        },
        ctx
      )
    ).resolves.toEqual({ success: false, message: 'launch failed' })
    await expect(deepSeekHarnessHandlers['deepseek_harness.stop'](undefined, ctx)).resolves.toEqual({
      success: false,
      message: 'stop failed'
    })
  })

  it('reports only the managed service status and URL', async () => {
    service.getStatus.mockReturnValue({ status: 'running', url: 'http://127.0.0.1:43123' })
    await expect(deepSeekHarnessHandlers['deepseek_harness.get_status'](undefined, ctx)).resolves.toEqual({
      status: 'running',
      url: 'http://127.0.0.1:43123'
    })
  })
})
