import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'

const { useAssistantMock, useProviderMock, updateAssistant } = vi.hoisted(() => ({
  useAssistantMock: vi.fn(),
  useProviderMock: vi.fn(),
  updateAssistant: vi.fn()
}))
vi.mock('@renderer/hooks/useAssistant', () => ({ useAssistant: useAssistantMock }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviderById: useProviderMock }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import nativeCodeExecutionTool from '../nativeCodeExecutionTool'

async function launcher() {
  const registerLaunchers = vi.fn<(items: ComposerToolLauncher[]) => () => void>(() => vi.fn())
  const Runtime = nativeCodeExecutionTool.composer!.runtime!
  render(<Runtime context={{ assistant: { id: 'a1' }, launcher: { registerLaunchers } } as any} />)
  await waitFor(() => expect(registerLaunchers).toHaveBeenCalled())
  return registerLaunchers.mock.calls[0][0][0]
}

describe('server-side code execution toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAssistantMock.mockReturnValue({
      assistant: { settings: {} },
      model: { id: 'grok::grok-4.7', apiModelId: 'grok-4.7', providerId: 'grok' },
      updateAssistant
    })
    useProviderMock.mockReturnValue({
      provider: {
        id: 'grok',
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: { 'openai-responses': { adapterFamily: 'xai-responses' } }
      }
    })
  })

  it('leaves old assistants opted out and persists explicit user opt-in', async () => {
    const control = await launcher()
    expect(control.active).toBe(false)
    expect(control.disabled).toBe(false)
    act(() => control.action?.({} as never))
    expect(updateAssistant).toHaveBeenCalledWith({ settings: { enableNativeCodeExecution: true } })
  })

  it('prevents opt-in for unsupported providers but lets an existing toggle be turned off', async () => {
    useProviderMock.mockReturnValue({ provider: { id: 'openai' } })
    const unavailable = await launcher()
    expect(unavailable.disabled).toBe(true)
    act(() => unavailable.action?.({} as never))
    expect(updateAssistant).not.toHaveBeenCalled()
    useAssistantMock.mockReturnValue({
      assistant: { settings: { enableNativeCodeExecution: true } },
      model: undefined,
      updateAssistant
    })
    const enabled = await launcher()
    expect(enabled.active).toBe(false)
    expect(enabled.disabled).toBe(false)
    act(() => enabled.action?.({} as never))
    expect(updateAssistant).toHaveBeenCalledWith({ settings: { enableNativeCodeExecution: false } })
  })
})
