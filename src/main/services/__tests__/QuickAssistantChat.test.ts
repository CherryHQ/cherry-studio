import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  defaultTemporary: false,
  open: vi.fn(() => 'quick-window'),
  activate: vi.fn(async () => undefined)
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return { get: () => state.defaultTemporary }
      if (name === 'WindowManager') return { open: state.open, getWindow: () => null }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    activate = state.activate
  },
  Injectable: () => (target: unknown) => target,
  ServicePhase: () => (target: unknown) => target,
  DependsOn: () => (target: unknown) => target,
  Phase: { WhenReady: 'whenReady' }
}))

import { QuickAssistantService } from '../QuickAssistantService'

beforeEach(() => vi.clearAllMocks())

describe('floating chat mode', () => {
  it.each([false, true])('uses the user default when mode is omitted (%s)', async (temporary) => {
    state.defaultTemporary = temporary
    await new QuickAssistantService().openChat({ prompt: '', submit: false })
    expect(state.open).toHaveBeenCalledWith('quickAssistant', {
      initData: expect.objectContaining({ temporary })
    })
  })

  it.each([false, true])('explicit mode overrides the opposite default (%s)', async (temporary) => {
    state.defaultTemporary = !temporary
    await new QuickAssistantService().openChat({ prompt: '', submit: false, temporary })
    expect(state.open).toHaveBeenCalledWith('quickAssistant', {
      initData: expect.objectContaining({ temporary })
    })
  })
})
