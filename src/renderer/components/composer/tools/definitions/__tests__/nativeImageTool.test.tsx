import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'

const { useAssistant, useProviderById, updateAssistant } = vi.hoisted(() => ({
  useAssistant: vi.fn(),
  useProviderById: vi.fn(),
  updateAssistant: vi.fn()
}))
vi.mock('@renderer/hooks/useAssistant', () => ({ useAssistant }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviderById }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import nativeImageTool from '../nativeImageTool'

// Regression: the native toggle must be available only on supported endpoints and must not flip the painting-model setting.
describe('native image composer opt-in', () => {
  beforeEach(() => {
    useAssistant.mockReturnValue({ assistant: { settings: {} }, updateAssistant })
    useProviderById.mockReturnValue({
      provider: {
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: { 'openai-responses': { adapterFamily: 'xai-responses' } }
      }
    })
    updateAssistant.mockReset()
  })
  function mount(endpoint = 'openai-responses') {
    const registerLaunchers = vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => vi.fn())
    const Runtime = nativeImageTool.composer!.runtime!
    render(
      <Runtime
        context={
          {
            assistant: { id: 'a1' },
            model: { id: 'grok::grok-4.7', apiModelId: 'grok-4.7', endpointTypes: [endpoint] },
            launcher: { registerLaunchers }
          } as any
        }
      />
    )
    return registerLaunchers
  }
  it('starts off and persists only the independent native setting when selected', async () => {
    const register = mount()
    await waitFor(() => expect(register).toHaveBeenCalled())
    const launcher = register.mock.calls[0][0][0]
    expect(launcher.label).toBe('chat.input.generate_image_native')
    expect(launcher.label).not.toBe('chat.input.generate_image')
    expect(launcher.active).toBe(false)
    launcher.action?.({} as never)
    expect(updateAssistant).toHaveBeenCalledWith({ settings: { enableNativeImageGeneration: true } })
  })
  it('does not offer native generation for a chat-completions endpoint', () => {
    expect(mount('openai-chat-completions')).not.toHaveBeenCalled()
  })
})
