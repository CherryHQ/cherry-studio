import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { quickAssistantHandlers } from '../quickAssistant'

const quickAssistantService = {
  hideQuickAssistant: vi.fn(),
  closeQuickAssistant: vi.fn(),
  setPinQuickAssistant: vi.fn()
}

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'QuickAssistantService') return quickAssistantService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('quickAssistantHandlers', () => {
  it('hide delegates to QuickAssistantService.hideQuickAssistant', async () => {
    await quickAssistantHandlers['quick_assistant.hide'](undefined, ctx)
    expect(quickAssistantService.hideQuickAssistant).toHaveBeenCalledOnce()
  })

  it('close delegates to QuickAssistantService.closeQuickAssistant', async () => {
    await quickAssistantHandlers['quick_assistant.close'](undefined, ctx)
    expect(quickAssistantService.closeQuickAssistant).toHaveBeenCalledOnce()
  })

  it('set_pin forwards the isPinned flag', async () => {
    await quickAssistantHandlers['quick_assistant.set_pin']({ isPinned: true }, ctx)
    expect(quickAssistantService.setPinQuickAssistant).toHaveBeenCalledWith(true)
  })
})
