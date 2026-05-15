import type { Provider } from '@shared/data/types/provider'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantSettingsTab from '../AssistantSettingsTab'

const { modelMock, providerStateMock, toastErrorMock, updateProviderMock, visibilityMock } = vi.hoisted(() => ({
  modelMock: {
    id: 'gpt-5.1',
    provider: 'openai',
    name: 'gpt-5.1',
    group: '',
    supported_endpoint_types: ['openai-response']
  },
  providerStateMock: {
    provider: undefined as Provider | undefined,
    isUpdating: false,
    updateError: undefined as Error | undefined
  },
  toastErrorMock: vi.fn(),
  updateProviderMock: vi.fn(),
  visibilityMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({
    description,
    message
  }: {
    className?: string
    description?: ReactNode
    message?: ReactNode
    showIcon?: boolean
    type?: string
  }) => (
    <div role="alert">
      <span>{message}</span>
      <span>{description}</span>
    </div>
  )
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock('@renderer/config/models/_bridge', () => ({
  fromSharedModel: (model: unknown) => model
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useDefaultModel: () => ({ defaultModel: undefined }),
  useModelById: () => ({ model: modelMock })
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: () => ({
    provider: providerStateMock.provider,
    updateProvider: updateProviderMock,
    isUpdating: providerStateMock.isUpdating,
    updateError: providerStateMock.updateError
  })
}))

vi.mock('@renderer/pages/chat-settings/ChatPreferenceSections', () => ({
  default: () => <div data-testid="chat-preferences" />
}))

vi.mock('@renderer/pages/chat-settings/settingsPanelPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingRowTitleSmall: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('../OpenAISettingsGroup', () => ({
  default: ({
    disabled,
    onProviderSettingsChange
  }: {
    disabled?: boolean
    onProviderSettingsChange: (providerSettings: Record<string, unknown>) => void
  }) => (
    <button
      type="button"
      data-testid="openai-settings-group"
      data-disabled={String(Boolean(disabled))}
      disabled={disabled}
      onClick={() => onProviderSettingsChange({ verbosity: 'high' })}>
      update openai settings
    </button>
  ),
  getOpenAISettingsVisibility: (...args: unknown[]) => visibilityMock(...args)
}))

vi.mock('../GroqSettingsGroup', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="groq-settings-group" data-disabled={String(Boolean(disabled))} />
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const openAiProvider = {
  id: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {
    arrayContent: true,
    streamOptions: true,
    developerRole: false,
    serviceTier: true,
    verbosity: true,
    enableThinking: true
  },
  settings: {
    verbosity: 'low'
  },
  isEnabled: true
} satisfies Provider

describe('AssistantSettingsTab', () => {
  beforeEach(() => {
    providerStateMock.provider = openAiProvider
    providerStateMock.isUpdating = false
    providerStateMock.updateError = undefined
    toastErrorMock.mockReset()
    updateProviderMock.mockReset()
    updateProviderMock.mockResolvedValue(openAiProvider)
    visibilityMock.mockReset()
    visibilityMock.mockImplementation((_model: unknown, provider: Provider) => ({
      hasVisibleSettings: provider.id !== 'groq'
    }))
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: toastErrorMock
      }
    })
  })

  it('passes provider update loading state to the provider settings group', () => {
    providerStateMock.isUpdating = true

    render(<AssistantSettingsTab assistant={{ id: 'assistant-1', modelId: 'openai::gpt-5.1' } as any} />)

    expect(screen.getByTestId('openai-settings-group')).toBeDisabled()
    expect(screen.getByTestId('openai-settings-group')).toHaveAttribute('data-disabled', 'true')
  })

  it('reports provider settings update failures from the panel handler', async () => {
    const user = userEvent.setup()
    updateProviderMock.mockRejectedValueOnce(new Error('save failed'))

    render(<AssistantSettingsTab assistant={{ id: 'assistant-1', modelId: 'openai::gpt-5.1' } as any} />)

    await user.click(screen.getByRole('button', { name: 'update openai settings' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('save failed')
    })
    expect(updateProviderMock).toHaveBeenCalledWith({ providerSettings: { verbosity: 'high' } })
  })

  it('shows the provider update error inside the settings panel', () => {
    providerStateMock.updateError = new Error('persist failed')

    render(<AssistantSettingsTab assistant={{ id: 'assistant-1', modelId: 'openai::gpt-5.1' } as any} />)

    expect(screen.getByRole('alert')).toHaveTextContent('common.error')
    expect(screen.getByRole('alert')).toHaveTextContent('persist failed')
  })
})
