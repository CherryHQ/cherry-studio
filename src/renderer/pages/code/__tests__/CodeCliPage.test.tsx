import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig, CodeCliToolState } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeCliPage from '../CodeCliPage'

const {
  clearCliConfigMock,
  injectCliConfigMock,
  readCliConfigFilesMock,
  extractConnectionFromCliConfigDraftMock,
  writeCliConfigDraftMock,
  useCodeCliMock,
  upsertProviderConfigMock,
  setCurrentProviderMock,
  reorderProvidersMock,
  selectToolMock,
  setTerminalMock,
  selectFolderMock,
  installMock,
  upgradeMock,
  removeMock,
  navigateMock,
  mockProviders,
  mockProviderConfigs
} = vi.hoisted(() => ({
  clearCliConfigMock: vi.fn(),
  injectCliConfigMock: vi.fn(),
  readCliConfigFilesMock: vi.fn(),
  extractConnectionFromCliConfigDraftMock: vi.fn(),
  writeCliConfigDraftMock: vi.fn(),
  useCodeCliMock: vi.fn(),
  upsertProviderConfigMock: vi.fn(),
  setCurrentProviderMock: vi.fn(),
  reorderProvidersMock: vi.fn(),
  selectToolMock: vi.fn(),
  setTerminalMock: vi.fn(),
  selectFolderMock: vi.fn(),
  installMock: vi.fn(),
  upgradeMock: vi.fn(),
  removeMock: vi.fn(),
  navigateMock: vi.fn(),
  mockProviders: [] as Provider[],
  mockProviderConfigs: {} as Record<string, CliProviderConfig>
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  isEnabled: true,
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
    content: '{"env":{"ANTHROPIC_MODEL":"claude-new"}}'
  }
]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    variant,
    size,
    loading,
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    size?: string
    loading?: boolean
    children?: ReactNode
  }) => {
    void variant
    void size
    void loading
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  ConfirmDialog: () => null
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => useCodeCliMock()
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mockProviders })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: vi.fn()
  }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@shared/data/presets/codeCliTools', () => ({
  CLI_TOOL_PRESET_MAP: {
    [CodeCli.CLAUDE_CODE]: {},
    [CodeCli.QODER_CLI]: {}
  }
}))

vi.mock('../cliConfig', () => ({
  clearCliConfig: (...args: unknown[]) => clearCliConfigMock(...args),
  cliConfigConnectionMatchesProvider: () => true,
  extractConnectionFromCliConfigDraft: (...args: unknown[]) => extractConnectionFromCliConfigDraftMock(...args),
  getClaudeContextModelId: (providerId: string, config: Record<string, unknown>) => {
    const env = config.env as Record<string, string> | undefined
    return env?.ANTHROPIC_DEFAULT_FABLE_MODEL ? `${providerId}::${env.ANTHROPIC_DEFAULT_FABLE_MODEL}` : undefined
  },
  hasClaudeDetailedModels: (config: Record<string, unknown>) => {
    const env = config.env as Record<string, string> | undefined
    return Boolean(env?.ANTHROPIC_DEFAULT_FABLE_MODEL)
  },
  injectCliConfig: (...args: unknown[]) => injectCliConfigMock(...args),
  readCliConfigFiles: (...args: unknown[]) => readCliConfigFilesMock(...args),
  sanitizeCliConfigBlob: (_cliTool: string, config: Record<string, unknown> | undefined) => config ?? {},
  writeCliConfigDraft: (...args: unknown[]) => writeCliConfigDraftMock(...args)
}))

vi.mock('../components/CodeCliSidebar', () => ({
  CodeCliSidebar: () => <div data-testid="code-cli-sidebar" />
}))

vi.mock('../components/ConfigList', () => ({
  ConfigList: ({
    providers,
    onConfigure,
    onToggleCurrent
  }: {
    providers: Provider[]
    onConfigure: (provider: Provider) => void
    onToggleCurrent: (provider: Provider) => void
  }) => (
    <div>
      {providers.length === 0 && <div data-testid="empty-config-list" />}
      {providers.map((item) => (
        <div key={item.id}>
          <button type="button" onClick={() => onToggleCurrent(item)}>
            toggle {item.id}
          </button>
          <button type="button" onClick={() => onConfigure(item)}>
            configure {item.id}
          </button>
        </div>
      ))}
    </div>
  )
}))

vi.mock('../components/configEditPanel/ConfigEditPanel', () => ({
  ConfigEditPanel: ({
    provider,
    providerConfig,
    onSubmit
  }: {
    provider: Provider
    providerConfig: CliProviderConfig | null
    onSubmit: (values: {
      modelId?: string
      cliConfigModelId?: string
      config?: Record<string, unknown>
      cliConfigFiles?: CliConfigFileDraft[]
      writePrimaryModel?: boolean
    }) => Promise<void>
  }) => (
    <div data-testid="config-panel" data-provider-id={provider.id} data-model-id={providerConfig?.modelId ?? ''}>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            modelId: 'anthropic::claude-new',
            config: { env: { TEST: 'true' } },
            cliConfigFiles
          })
        }>
        save model
      </button>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            modelId: undefined,
            cliConfigModelId: 'anthropic::claude-new',
            config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } },
            cliConfigFiles,
            writePrimaryModel: false
          })
        }>
        save detailed config
      </button>
    </div>
  )
}))

vi.mock('../components/LaunchDialog', () => ({
  LaunchDialog: () => null
}))

vi.mock('../components/VersionStatusCard', () => ({
  VersionStatusCard: ({ canLaunch }: { canLaunch?: boolean }) => (
    <div data-can-launch={String(canLaunch)} data-testid="version-status-card" />
  )
}))

vi.mock('../constants/cliTools', () => ({
  CLI_TOOLS: [
    { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: () => null },
    { value: CodeCli.QODER_CLI, label: 'Qoder CLI', icon: () => null }
  ],
  PROVIDERLESS_CLI_TOOLS: new Set([CodeCli.QODER_CLI])
}))

vi.mock('../hooks/useAvailableTerminals', () => ({
  useAvailableTerminals: () => []
}))

vi.mock('../hooks/useBinaryActions', () => ({
  useBinaryActions: () => ({
    install: installMock,
    upgrade: upgradeMock,
    remove: removeMock,
    installingTools: new Set(),
    upgradingTools: new Set()
  })
}))

vi.mock('../hooks/useCliVersionStatuses', () => ({
  useCliVersionStatuses: () => ({
    [CodeCli.CLAUDE_CODE]: { installed: true, canUpgrade: false },
    [CodeCli.QODER_CLI]: { installed: true, canUpgrade: false }
  })
}))

vi.mock('../hooks/useConfigMetadata', () => ({
  useConfigMetadata: () => ({
    filterProviders: (providers: Provider[]) => providers,
    makeModelFilter: () => () => true,
    resolveProviderMeta: (item: Provider, config?: CliProviderConfig) => ({
      providerName: item.name,
      modelName: config?.modelId
    })
  })
}))

function mockCodeCliState({
  providerConfigs = {},
  currentProviderId = null,
  selectedCliTool = CodeCli.CLAUDE_CODE
}: {
  providerConfigs?: Record<string, CliProviderConfig>
  currentProviderId?: string | null
  selectedCliTool?: CodeCli
} = {}) {
  Object.keys(mockProviderConfigs).forEach((key) => delete mockProviderConfigs[key])
  Object.assign(mockProviderConfigs, providerConfigs)

  const currentToolState: CodeCliToolState = {
    providers: mockProviderConfigs,
    current: currentProviderId
  }

  useCodeCliMock.mockReturnValue({
    selectedCliTool,
    currentToolState,
    currentProviderId,
    currentProviderConfig: currentProviderId ? (mockProviderConfigs[currentProviderId] ?? null) : null,
    providerConfigs: mockProviderConfigs,
    directory: '/tmp/project',
    selectedTerminal: undefined,
    upsertProviderConfig: upsertProviderConfigMock,
    setCurrentProvider: setCurrentProviderMock,
    reorderProviders: reorderProvidersMock,
    selectTool: selectToolMock,
    setTerminal: setTerminalMock,
    selectFolder: selectFolderMock
  })
}

describe('CodeCliPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviders.splice(0, mockProviders.length, provider)
    mockCodeCliState()
    clearCliConfigMock.mockResolvedValue(undefined)
    injectCliConfigMock.mockResolvedValue(undefined)
    readCliConfigFilesMock.mockResolvedValue([])
    extractConnectionFromCliConfigDraftMock.mockReturnValue(null)
    writeCliConfigDraftMock.mockResolvedValue(undefined)
    upsertProviderConfigMock.mockResolvedValue('anthropic')
    setCurrentProviderMock.mockResolvedValue(undefined)
    reorderProvidersMock.mockResolvedValue(undefined)
    selectFolderMock.mockResolvedValue('/tmp/project')
    navigateMock.mockResolvedValue(undefined)
    Object.assign(window, { toast: { error: vi.fn() } })
  })

  it('opens the config dialog instead of auto-selecting the first model when enabling an unconfigured provider', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))

    expect(await screen.findByTestId('config-panel')).toHaveAttribute('data-provider-id', 'anthropic')
    expect(screen.getByTestId('config-panel')).toHaveAttribute('data-model-id', '')
    expect(upsertProviderConfigMock).not.toHaveBeenCalled()
    expect(injectCliConfigMock).not.toHaveBeenCalled()
    expect(writeCliConfigDraftMock).not.toHaveBeenCalled()
    expect(setCurrentProviderMock).not.toHaveBeenCalled()
  })

  it('enables the provider after the user selects and saves a model from the pending config dialog', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))
    fireEvent.click(await screen.findByText('save model'))

    await waitFor(() =>
      expect(upsertProviderConfigMock).toHaveBeenCalledWith('anthropic', {
        modelId: 'anthropic::claude-new',
        config: { env: { TEST: 'true' } }
      })
    )
    expect(writeCliConfigDraftMock).toHaveBeenCalledWith({
      cliTool: CodeCli.CLAUDE_CODE,
      modelId: 'anthropic::claude-new',
      configBlob: { env: { TEST: 'true' } },
      files: cliConfigFiles,
      writePrimaryModel: true
    })
    expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic')
  })

  it('enables the provider after saving detailed config from the pending dialog', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))
    fireEvent.click(await screen.findByText('save detailed config'))

    await waitFor(() =>
      expect(upsertProviderConfigMock).toHaveBeenCalledWith('anthropic', {
        modelId: '',
        config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } }
      })
    )
    expect(writeCliConfigDraftMock).toHaveBeenCalledWith({
      cliTool: CodeCli.CLAUDE_CODE,
      modelId: 'anthropic::claude-new',
      configBlob: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } },
      files: cliConfigFiles,
      writePrimaryModel: false
    })
    expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic')
  })

  it('enables an existing detailed-only provider without writing a common model', async () => {
    mockCodeCliState({
      providerConfigs: {
        anthropic: {
          modelId: '',
          config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } }
        }
      }
    })
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))

    await waitFor(() =>
      expect(injectCliConfigMock).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-new',
        configBlob: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } },
        writePrimaryModel: false
      })
    )
    expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic')
  })

  it('shows a provider selection hint when launch needs a current provider', () => {
    render(<CodeCliPage />)

    expect(screen.getByText('code.select_provider_before_launch')).toBeInTheDocument()
    expect(screen.getByTestId('version-status-card')).toHaveAttribute('data-can-launch', 'false')
  })

  it('hides the provider selection hint once a current provider is selected', () => {
    mockCodeCliState({
      providerConfigs: {
        anthropic: { modelId: 'anthropic::claude-new', config: {} }
      },
      currentProviderId: 'anthropic'
    })

    render(<CodeCliPage />)

    expect(screen.queryByText('code.select_provider_before_launch')).not.toBeInTheDocument()
    expect(screen.getByTestId('version-status-card')).toHaveAttribute('data-can-launch', 'true')
  })

  it('does not show the provider selection hint for provider-less tools', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.QODER_CLI })

    render(<CodeCliPage />)

    expect(screen.queryByText('code.select_provider_before_launch')).not.toBeInTheDocument()
    expect(screen.getByTestId('version-status-card')).toHaveAttribute('data-can-launch', 'true')
  })

  it('does not show the provider selection hint when no supported providers exist', () => {
    mockProviders.splice(0, mockProviders.length)
    mockCodeCliState()

    render(<CodeCliPage />)

    expect(screen.queryByText('code.select_provider_before_launch')).not.toBeInTheDocument()
    expect(screen.getByTestId('empty-config-list')).toBeInTheDocument()
  })
})
