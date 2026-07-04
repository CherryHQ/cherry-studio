import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigEditPanel } from '../ConfigEditPanel'

const {
  extractConfigFromCliConfigDraftMock,
  extractConnectionFromCliConfigDraftMock,
  readCliConfigDraftMock,
  readCliConfigFilesMock,
  updateCliConfigDraftConfigMock,
  validateCliConfigDraftForWriteMock
} = vi.hoisted(() => ({
  extractConfigFromCliConfigDraftMock: vi.fn(),
  extractConnectionFromCliConfigDraftMock: vi.fn(),
  readCliConfigDraftMock: vi.fn(),
  readCliConfigFilesMock: vi.fn(),
  updateCliConfigDraftConfigMock: vi.fn(),
  validateCliConfigDraftForWriteMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading,
    size,
    variant,
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    size?: string
    variant?: string
  }) => {
    void loading
    void size
    void variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({ onSelect, trigger }: { onSelect: (modelId: UniqueModelId) => void; trigger: ReactNode }) => (
    <div data-testid="model-selector">
      <button type="button" onClick={() => onSelect('anthropic::claude-new' as UniqueModelId)}>
        select new model
      </button>
      {trigger}
    </div>
  )
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingHelpText: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SettingTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: { id: 'anthropic::claude-old', name: 'Claude Old' } })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: (provider: Provider) => provider.name,
  useProviderApiKeys: () => ({ data: { keys: [] } })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/pages/code/cliConfig', () => ({
  cliConfigConnectionMatchesProvider: () => false,
  extractConfigFromCliConfigDraft: (...args: unknown[]) => extractConfigFromCliConfigDraftMock(...args),
  extractConnectionFromCliConfigDraft: (...args: unknown[]) => extractConnectionFromCliConfigDraftMock(...args),
  readCliConfigDraft: (...args: unknown[]) => readCliConfigDraftMock(...args),
  readCliConfigFiles: (...args: unknown[]) => readCliConfigFilesMock(...args),
  updateCliConfigDraftConfig: (...args: unknown[]) => updateCliConfigDraftConfigMock(...args),
  validateCliConfigDraftForWrite: (...args: unknown[]) => validateCliConfigDraftForWriteMock(...args)
}))

vi.mock('../CliConfigEditor', () => ({
  CliConfigEditor: () => <div data-testid="cli-config-editor" />
}))

vi.mock('../tools/ClaudeConfigFields', () => ({
  ClaudeConfigFields: () => <div data-testid="claude-config-fields" />
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  endpointConfigs: {
    'anthropic-messages': {
      baseUrl: 'https://api.anthropic.com'
    }
  }
} as Provider

const cliConfigFiles: CliConfigFileDraft[] = [
  {
    target: 'claude-settings',
    label: 'settings.json',
    path: '/tmp/settings.json',
    language: 'json',
    content: '{"env":{"ANTHROPIC_BASE_URL":"https://other.example.com","ANTHROPIC_MODEL":"claude-other"}}'
  }
]

function renderPanel(onSubmit = vi.fn()) {
  readCliConfigFilesMock.mockResolvedValue(cliConfigFiles)
  readCliConfigDraftMock.mockResolvedValue(cliConfigFiles)
  extractConnectionFromCliConfigDraftMock.mockReturnValue({
    baseUrl: 'https://other.example.com',
    model: 'claude-other'
  })
  extractConfigFromCliConfigDraftMock.mockReturnValue({})

  render(
    <ConfigEditPanel
      open
      onClose={vi.fn()}
      cliTool={CodeCli.CLAUDE_CODE}
      provider={provider}
      providerConfig={{ modelId: 'anthropic::claude-old' as UniqueModelId, config: {} }}
      isCurrentProvider
      defaultModelId={'anthropic::claude-new' as UniqueModelId}
      modelFilter={() => true}
      onSubmit={onSubmit}
    />
  )

  return { onSubmit }
}

describe('ConfigEditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the model selector available when the current CLI config points at another model', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    expect(screen.getAllByText('code.cli_config.unknown_provider')).toHaveLength(2)
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  it('clears unknown CLI selection when a model is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderPanel(onSubmit)

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('code.cli_config.unknown_provider')).toHaveLength(2))

    fireEvent.click(screen.getByText('select new model'))
    await waitFor(() => expect(screen.queryAllByText('code.cli_config.unknown_provider')).toHaveLength(0))
    await waitFor(() => expect(readCliConfigDraftMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'anthropic::claude-new'
      })
    )
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('cliConfigOnly')
  })
})
