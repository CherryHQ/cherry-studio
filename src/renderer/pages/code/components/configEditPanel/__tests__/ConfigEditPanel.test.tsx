import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
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
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SegmentedControl: <TValue extends string>({
    options,
    value,
    onValueChange
  }: {
    options: readonly { value: TValue; label: ReactNode }[]
    value: TValue
    onValueChange: (value: TValue) => void
  }) => (
    <div role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveProviderIcon: (id: string) =>
    id === 'anthropic' ? () => <span data-testid="provider-icon-anthropic" /> : undefined
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatarPrimitive: ({ providerName }: { providerName: string }) => (
    <span aria-hidden data-testid={`provider-avatar-${providerName}`} />
  )
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
  useModelById: (id: UniqueModelId | null | undefined) => ({
    model: id ? { id, name: id === 'anthropic::claude-old' ? 'Claude Old' : 'Claude New' } : undefined
  })
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
  ClaudeConfigFields: ({
    onChange,
    section = 'all'
  }: {
    onChange: (next: Record<string, unknown>) => void
    section?: string
  }) => (
    <div data-testid={`claude-config-fields-${section}`}>
      {section === 'basic' && (
        <button type="button" onClick={() => onChange({ changed: true })}>
          change config
        </button>
      )}
    </div>
  )
}))

vi.mock('../tools/CodexConfigFields', () => ({
  CodexConfigFields: ({ section = 'all' }: { section?: string }) => (
    <div data-testid={`codex-config-fields-${section}`} />
  )
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

function renderPanel(
  onSubmit = vi.fn(),
  options: {
    cliTool?: CodeCli
    isCurrentProvider?: boolean
    providerConfig?: CliProviderConfig | null
  } = {}
) {
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
      cliTool={options.cliTool ?? CodeCli.CLAUDE_CODE}
      provider={provider}
      providerConfig={
        options.providerConfig === undefined
          ? { modelId: 'anthropic::claude-old' as UniqueModelId, config: {} }
          : options.providerConfig
      }
      isCurrentProvider={options.isCurrentProvider ?? true}
      modelFilter={() => true}
      onSubmit={onSubmit}
    />
  )

  return { onSubmit }
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
}

describe('ConfigEditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the model selector available when the current CLI config points at another model', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    expect(screen.getByText('code.model_selection')).toBeInTheDocument()
    expect(screen.getAllByText('code.cli_config.unknown_provider')).toHaveLength(1)
    expect(screen.queryByText('code.endpoint_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.model_hint_config')).not.toBeInTheDocument()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByText('code.model_mode.common')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('code.model_mode.detailed')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('claude-config-fields-advanced')).not.toBeInTheDocument()
  })

  it('switches Claude model selection between common and detailed modes', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('claude-config-fields-advanced')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('code.model_mode.detailed'))

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.getByTestId('claude-config-fields-advanced')).toBeInTheDocument()
  })

  it('shows the empty model placeholder when the provider has no saved model', async () => {
    renderPanel(vi.fn(), { isCurrentProvider: false, providerConfig: null })

    await waitFor(() =>
      expect(readCliConfigFilesMock).toHaveBeenCalledWith(CodeCli.CLAUDE_CODE, { includeEmpty: true })
    )

    expect(screen.getByText('settings.models.empty')).toBeInTheDocument()
    expect(screen.queryByText('Claude Old')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude New')).not.toBeInTheDocument()
    expect(screen.getByText('common.save')).toBeDisabled()
    expect(readCliConfigDraftMock).not.toHaveBeenCalled()
  })

  it('keeps the CLI config editor visible without a saved model', async () => {
    const codexFiles: CliConfigFileDraft[] = [
      {
        target: 'codex-config',
        label: 'Codex config.toml',
        path: '/tmp/config.toml',
        language: 'toml',
        content: ''
      },
      {
        target: 'codex-auth',
        label: 'Codex auth.json',
        path: '/tmp/auth.json',
        language: 'json',
        content: ''
      }
    ]
    readCliConfigFilesMock.mockResolvedValue(codexFiles)

    renderPanel(vi.fn(), {
      cliTool: CodeCli.OPENAI_CODEX,
      isCurrentProvider: false,
      providerConfig: null
    })

    await waitFor(() =>
      expect(readCliConfigFilesMock).toHaveBeenCalledWith(CodeCli.OPENAI_CODEX, { includeEmpty: true })
    )

    fireEvent.click(screen.getByText('common.advanced_settings'))

    expect(screen.getByTestId('cli-config-editor')).toBeInTheDocument()
    expect(readCliConfigDraftMock).not.toHaveBeenCalled()
  })

  it('renders the dialog title as provider icon and provider name', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    const avatar = screen.getByTestId('provider-avatar-Anthropic')
    const title = screen.getByRole('heading', { name: 'Anthropic' })

    expect(title).toContainElement(avatar)
    expect(title).toHaveTextContent('Anthropic')
    expect(screen.queryByText('code.configuring_provider')).not.toBeInTheDocument()
  })

  it('renders parameter settings above advanced settings', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    const modelTitle = screen.getByText('code.model_selection')
    const toolTitle = screen.getByText('code.tool_parameters')
    const basicFields = screen.getByTestId('claude-config-fields-basic')
    const advancedToggle = screen.getByText('common.advanced_settings')

    expect(screen.queryByTestId('claude-config-fields-advanced')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cli-config-editor')).not.toBeInTheDocument()

    fireEvent.click(advancedToggle)

    const cliConfigEditor = screen.getByTestId('cli-config-editor')

    expectBefore(modelTitle, toolTitle)
    expectBefore(toolTitle, basicFields)
    expectBefore(basicFields, advancedToggle)
    expectBefore(advancedToggle, cliConfigEditor)
    expect(screen.queryByTestId('claude-config-fields-advanced')).not.toBeInTheDocument()
  })

  it('keeps save disabled until the draft changes', async () => {
    renderPanel()

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())

    const saveButton = screen.getByText('common.save')
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByText('select new model'))
    await waitFor(() => expect(saveButton).not.toBeDisabled())
  })

  it('saves current unknown CLI config as a config-file-only draft', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const updatedCliConfigFiles = [{ ...cliConfigFiles[0], content: '{"env":{"CHANGED":"true"}}' }]
    updateCliConfigDraftConfigMock.mockReturnValue(updatedCliConfigFiles)
    renderPanel(onSubmit)

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('code.cli_config.unknown_provider')).toHaveLength(1))

    fireEvent.click(screen.getByText('change config'))
    await waitFor(() => expect(screen.getByText('common.save')).not.toBeDisabled())
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith({
      modelId: 'anthropic::claude-old',
      cliConfigFiles: updatedCliConfigFiles,
      cliConfigOnly: true
    })
  })

  it('clears unknown CLI selection when a model is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderPanel(onSubmit)

    await waitFor(() => expect(readCliConfigFilesMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('code.cli_config.unknown_provider')).toHaveLength(1))

    fireEvent.click(screen.getByText('select new model'))
    await waitFor(() => expect(screen.queryAllByText('code.cli_config.unknown_provider')).toHaveLength(0))
    await waitFor(() =>
      expect(readCliConfigDraftMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic::claude-new',
          files: cliConfigFiles
        })
      )
    )
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'anthropic::claude-new'
      })
    )
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('cliConfigOnly')
  })

  it('renders a managed preview draft for a provider that is not current', async () => {
    renderPanel(vi.fn(), { isCurrentProvider: false })

    await waitFor(() =>
      expect(readCliConfigDraftMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic::claude-old',
          configBlob: {},
          files: cliConfigFiles
        })
      )
    )

    expect(screen.queryByText('code.cli_config.unknown_provider')).not.toBeInTheDocument()
  })
})
