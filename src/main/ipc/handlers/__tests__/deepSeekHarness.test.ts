import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { deepSeekHarnessHandlers } from '../deepSeekHarness'

const service = {
  start: vi.fn(),
  stop: vi.fn()
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
})
