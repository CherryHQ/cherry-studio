import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'
import type { CliProviderConfig, CodeCliToolState } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeCliPage from '../CodeCliPage'

const {
  clearCliConfigMock,
  readCliConfigFilesMock,
  extractConnectionFromCliConfigDraftMock,
  cliConfigConnectionMatchesProviderMock,
  writeCliConfigDraftMock,
  writeOwnLoginCliConfigDraftMock,
  useCodeCliMock,
  upsertProviderConfigMock,
  deleteProviderConfigMock,
  setCurrentProviderMock,
  reorderProvidersMock,
  selectToolMock,
  setTerminalMock,
  selectFolderMock,
  installMock,
  upgradeMock,
  removeMock,
  toastErrorMock,
  navigateMock,
  openSettingsTabMock,
  ipcRequestMock,
  ipcEventHandlers,
  versionStatusesMock,
  versionStatusesResolvedState,
  mockProviders,
  mockProviderConfigs,
  providersLoadingState,
  unsupportedProviderIds,
  gatewayState
} = vi.hoisted(() => ({
  clearCliConfigMock: vi.fn(),
  readCliConfigFilesMock: vi.fn(),
  extractConnectionFromCliConfigDraftMock: vi.fn(),
  cliConfigConnectionMatchesProviderMock: vi.fn(),
  writeCliConfigDraftMock: vi.fn(),
  writeOwnLoginCliConfigDraftMock: vi.fn(),
  useCodeCliMock: vi.fn(),
  upsertProviderConfigMock: vi.fn(),
  deleteProviderConfigMock: vi.fn(),
  setCurrentProviderMock: vi.fn(),
  reorderProvidersMock: vi.fn(),
  selectToolMock: vi.fn(),
  setTerminalMock: vi.fn(),
  selectFolderMock: vi.fn(),
  installMock: vi.fn(),
  upgradeMock: vi.fn(),
  removeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  navigateMock: vi.fn(),
  openSettingsTabMock: vi.fn(),
  ipcRequestMock: vi.fn(),
  ipcEventHandlers: new Map<string, (payload: unknown) => void>(),
  versionStatusesMock: vi.fn(),
  versionStatusesResolvedState: { value: true },
  mockProviders: [] as Provider[],
  mockProviderConfigs: {} as Record<string, CliProviderConfig>,
  providersLoadingState: { value: false },
  unsupportedProviderIds: new Set<string>(),
  gatewayState: {
    bundle: null as {
      provider: Provider
      apiKey: string | null
      ensureRunning: ReturnType<typeof vi.fn>
      getApiKey: ReturnType<typeof vi.fn>
    } | null,
    defaultModelId: undefined as string | undefined,
    modelsById: new Map<string, { id: string; providerId: string; modelId: string; apiModelId: string; name: string }>()
  }
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
  // No `role` here: the real Alert derives it from `type` (`status` for anything but
  // `error`), so hardcoding one would let assertions pin a role the component never emits.
  Alert: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
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
  ConfirmDialog: ({ open, onConfirm }: { open?: boolean; onConfirm?: () => void | Promise<void> }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm?.()}>
        confirm remove
      </button>
    ) : null,
  // Dialog family used by BinaryInstallErrorDialog (rendered by CodeCliContentPanel).
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Select: ({
    children,
    value,
    onValueChange
  }: {
    children: ReactNode
    value?: string
    onValueChange: (value: string) => void
  }) => {
    void onValueChange
    return <div data-value={value}>{children}</div>
  },
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SearchInput: ({
    value,
    placeholder,
    onChange
  }: {
    value: string
    placeholder?: string
    onChange: (event: { target: { value: string } }) => void
  }) => <input type="search" value={value} placeholder={placeholder} onChange={onChange} />
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => useCodeCliMock()
}))

vi.mock('../hooks/useApiGatewayProvider', () => ({
  useApiGatewayProvider: () => gatewayState.bundle
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [...gatewayState.modelsById.values()], isLoading: false })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mockProviders, isLoading: providersLoadingState.value })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => ipcRequestMock(...args)
  },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => ipcEventHandlers.set(event, handler)
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

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: (...args: unknown[]) => openSettingsTabMock(...args)
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
}))

vi.mock('../cliConfig/claudeModels', () => ({
  getClaudeContextModelId: (providerId: string, config: Record<string, unknown>) => {
    const env = config.env as Record<string, string> | undefined
    return env?.ANTHROPIC_DEFAULT_FABLE_MODEL ? `${providerId}::${env.ANTHROPIC_DEFAULT_FABLE_MODEL}` : undefined
  },
  hasClaudeDetailedModels: (config: Record<string, unknown>) => {
    const env = config.env as Record<string, string> | undefined
    return Boolean(env?.ANTHROPIC_DEFAULT_FABLE_MODEL)
  }
}))

vi.mock('../cliConfig/clear', () => ({
  clearCliConfig: (...args: unknown[]) => clearCliConfigMock(...args)
}))

vi.mock('../cliConfig/draft', () => ({
  readCliConfigFiles: (...args: unknown[]) => readCliConfigFilesMock(...args),
  writeCliConfigDraft: (...args: unknown[]) => writeCliConfigDraftMock(...args),
  writeOwnLoginCliConfigDraft: (...args: unknown[]) => writeOwnLoginCliConfigDraftMock(...args),
  // Literal (not CodeCli.CLAUDE_CODE) — vi.mock factories are hoisted above imports.
  isOwnLoginConfigurable: (cliTool: string) => cliTool === 'claude-code'
}))

vi.mock('../cliConfig/parser', () => ({
  extractConnectionFromCliConfigDraft: (...args: unknown[]) => extractConnectionFromCliConfigDraftMock(...args)
}))

vi.mock('../cliConfig/providerMatching', () => ({
  cliConfigConnectionMatchesProvider: (...args: unknown[]) => cliConfigConnectionMatchesProviderMock(...args)
}))

// `sanitizeCliConfigBlob` now lives in the adapter registry (re-exported via the barrel).
// Keep the real registry so any transitive importer of `adapters` (getAdapter/CLI_CONFIG_ADAPTERS)
// still resolves; override only the sanitizer this test asserts on.
vi.mock('../cliConfig/adapters', async (importOriginal) => ({
  // oxlint-disable-next-line consistent-type-imports
  ...(await importOriginal<typeof import('../cliConfig/adapters')>()),
  sanitizeCliConfigBlob: (_cliTool: string, config: Record<string, unknown> | undefined) => config ?? {}
}))

vi.mock('../components/ConfigList', () => ({
  ConfigList: ({
    providers,
    onConfigure,
    onToggleCurrent,
    providerActionsDisabled
  }: {
    providers: Provider[]
    onConfigure: (provider: Provider) => void
    onToggleCurrent: (provider: Provider) => void
    providerActionsDisabled?: boolean
  }) => (
    <div>
      {providers.length === 0 && <div data-testid="empty-config-list" />}
      {providers.map((item) => (
        <div key={item.id}>
          <button type="button" disabled={providerActionsDisabled} onClick={() => onToggleCurrent(item)}>
            toggle {item.id}
          </button>
          <button type="button" disabled={providerActionsDisabled} onClick={() => onConfigure(item)}>
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

vi.mock('../components/configEditPanel/OwnLoginConfigPanel', () => ({
  OwnLoginConfigPanel: ({
    toolName,
    onSubmit
  }: {
    toolName: string
    onSubmit: (values: { config: Record<string, unknown> }) => Promise<void>
  }) => (
    <div data-testid="own-login-config-panel" data-tool-name={toolName}>
      <button type="button" onClick={() => void onSubmit({ config: { effortLevel: 'high' } })}>
        save own-login
      </button>
    </div>
  )
}))

vi.mock('../components/LaunchDialog', () => ({
  LaunchDialog: ({ open, onLaunch }: { open: boolean; onLaunch: () => void }) =>
    open ? (
      <button type="button" onClick={onLaunch}>
        launch tool
      </button>
    ) : null
}))

vi.mock('../components/VersionStatusCard', () => ({
  VersionStatusCard: ({
    canLaunch,
    onRemove,
    onLaunch,
    onUpgrade,
    upgradeDisabled,
    installError,
    onShowError,
    launchDisabledHint
  }: {
    canLaunch?: boolean
    onRemove?: () => void
    onLaunch?: () => void
    onUpgrade?: () => void
    upgradeDisabled?: boolean
    installError?: string
    onShowError?: () => void
    launchDisabledHint?: string
  }) => (
    <div
      data-can-launch={String(canLaunch)}
      data-launch-disabled-hint={launchDisabledHint}
      data-testid="version-status-card">
      {onRemove && (
        <button type="button" onClick={onRemove}>
          remove tool
        </button>
      )}
      {onLaunch && (
        <button type="button" disabled={!canLaunch} onClick={onLaunch}>
          start tool
        </button>
      )}
      {onUpgrade && (
        <button type="button" disabled={upgradeDisabled} onClick={onUpgrade}>
          upgrade tool
        </button>
      )}
      {installError && (
        <button type="button" onClick={onShowError}>
          show error
        </button>
      )}
    </div>
  )
}))

vi.mock('../constants/cliTools', () => ({
  CLI_TOOLS: [
    { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: () => null },
    { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: () => null },
    { value: CodeCli.ANTIGRAVITY_CLI, label: 'Antigravity CLI', icon: () => null },
    { value: CodeCli.GEMINI_CLI, label: 'Gemini CLI', icon: () => null },
    { value: CodeCli.OPEN_CODE, label: 'OpenCode', icon: () => null },
    { value: CodeCli.DEEPSEEK_HARNESS, label: 'DeepSeek Harness', icon: () => null },
    { value: CodeCli.HERMES, label: 'Hermes', icon: () => null },
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
  useCliVersionStatuses: () => ({ statuses: versionStatusesMock(), resolved: versionStatusesResolvedState.value })
}))

vi.mock('../hooks/useConfigMetadata', () => ({
  useConfigMetadata: () => ({
    filterProviders: (providers: Provider[]) => providers.filter((item) => !unsupportedProviderIds.has(item.id)),
    filterProvidersForTool: (_toolId: CodeCli, providers: Provider[]) =>
      providers.filter((item) => !unsupportedProviderIds.has(item.id)),
    makeModelFilter: () => () => true,
    resolveProviderMeta: (item: Provider, config?: CliProviderConfig) => ({
      providerName: item.name,
      modelName: config?.modelId
    }),
    resolveProviderMetaForTool: (_toolId: CodeCli, item: Provider, config?: CliProviderConfig) => ({
      providerName: item.name,
      modelName: config?.modelId
    }),
    gatewayModelsById: gatewayState.modelsById,
    defaultGatewayModelId: gatewayState.defaultModelId
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
    configs: { [selectedCliTool]: currentToolState },
    selectedCliTool,
    currentToolState,
    currentProviderId,
    currentProviderConfig: currentProviderId ? (mockProviderConfigs[currentProviderId] ?? null) : null,
    providerConfigs: mockProviderConfigs,
    directory: '/tmp/project',
    selectedTerminal: undefined,
    upsertProviderConfig: upsertProviderConfigMock,
    deleteProviderConfig: deleteProviderConfigMock,
    setCurrentProvider: setCurrentProviderMock,
    reorderProviders: reorderProvidersMock,
    selectTool: selectToolMock,
    setTerminal: setTerminalMock,
    selectFolder: selectFolderMock
  })
}

function baseVersionStatuses(overrides: Partial<Record<CodeCli, Record<string, unknown>>> = {}) {
  const base = { installed: true, source: 'mise', applicationStatus: 'applied', canUpgrade: false }
  return {
    [CodeCli.CLAUDE_CODE]: { ...base, ...overrides[CodeCli.CLAUDE_CODE] },
    [CodeCli.OPENAI_CODEX]: { ...base, ...overrides[CodeCli.OPENAI_CODEX] },
    [CodeCli.ANTIGRAVITY_CLI]: { ...base, ...overrides[CodeCli.ANTIGRAVITY_CLI] },
    [CodeCli.GEMINI_CLI]: {
      ...base,
      installed: false,
      source: 'none',
      ...overrides[CodeCli.GEMINI_CLI]
    },
    [CodeCli.OPEN_CODE]: { ...base, ...overrides[CodeCli.OPEN_CODE] },
    [CodeCli.DEEPSEEK_HARNESS]: { ...base, ...overrides[CodeCli.DEEPSEEK_HARNESS] },
    [CodeCli.HERMES]: { ...base, ...overrides[CodeCli.HERMES] },
    [CodeCli.QODER_CLI]: { ...base, ...overrides[CodeCli.QODER_CLI] }
  }
}

describe('CodeCliPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    mockProviders.splice(0, mockProviders.length, provider)
    providersLoadingState.value = false
    unsupportedProviderIds.clear()
    gatewayState.bundle = null
    gatewayState.defaultModelId = undefined
    gatewayState.modelsById.clear()
    mockCodeCliState()
    versionStatusesMock.mockReturnValue(baseVersionStatuses())
    versionStatusesResolvedState.value = true
    clearCliConfigMock.mockResolvedValue(undefined)
    readCliConfigFilesMock.mockResolvedValue([])
    extractConnectionFromCliConfigDraftMock.mockReturnValue(null)
    cliConfigConnectionMatchesProviderMock.mockReturnValue(true)
    writeCliConfigDraftMock.mockResolvedValue(undefined)
    upsertProviderConfigMock.mockResolvedValue('anthropic')
    deleteProviderConfigMock.mockResolvedValue(undefined)
    setCurrentProviderMock.mockResolvedValue(undefined)
    reorderProvidersMock.mockResolvedValue(undefined)
    selectFolderMock.mockResolvedValue('/tmp/project')
    navigateMock.mockResolvedValue(undefined)
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'deepseek_harness.get_status' || route === 'hermes_dashboard.get_status')
        return { status: 'stopped' }
      if (route === 'hermes_dashboard.start') return { success: true, url: 'http://127.0.0.1:49152' }
      return { success: true }
    })
  })

  it('shows Antigravity immediately while hiding Gemini until installation status is resolved', () => {
    versionStatusesMock.mockReturnValue({})
    versionStatusesResolvedState.value = false

    render(<CodeCliPage />)

    expect(screen.getByText('Antigravity CLI')).toBeInTheDocument()
    expect(screen.queryByText('Gemini CLI')).not.toBeInTheDocument()
  })

  // A broken managed install is installed:false with no shim, so the `installed` filter hid the
  // tool entirely — taking the Retry/Remove that repair or undo it out of reach for good.
  it('keeps a broken Gemini installation reachable so it can be repaired or removed', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.GEMINI_CLI })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.GEMINI_CLI]: { installed: false, source: 'none', applicationStatus: 'broken' }
      })
    )

    render(<CodeCliPage />)

    expect(screen.getByText('Gemini CLI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'remove tool' })).toBeInTheDocument()
    expect(selectToolMock).not.toHaveBeenCalled()
  })

  // The redirect used to bail whenever the status was absent, so a permanently failed read left
  // a selected Gemini hidden AND unredirected — an empty pane with no way out.
  it('falls back off a selected Gemini when the status read never produces one', async () => {
    mockCodeCliState({ selectedCliTool: CodeCli.GEMINI_CLI })
    versionStatusesMock.mockReturnValue({})

    render(<CodeCliPage />)

    await waitFor(() => expect(selectToolMock).toHaveBeenCalledWith(CodeCli.CLAUDE_CODE))
  })

  it('keeps a selected Gemini selected while its status is still unresolved', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.GEMINI_CLI })
    versionStatusesMock.mockReturnValue({})
    versionStatusesResolvedState.value = false

    render(<CodeCliPage />)

    // Redirecting on an in-flight read would move an installed-Gemini user off it on every start.
    expect(selectToolMock).not.toHaveBeenCalled()
  })

  it.each(['system', 'mise'] as const)('shows an installed Gemini CLI from the %s snapshot', (source) => {
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.GEMINI_CLI]: { installed: true, source }
      })
    )

    render(<CodeCliPage />)

    expect(screen.getByText('Gemini CLI')).toBeInTheDocument()
  })

  it('falls back to the first visible tool after a selected Gemini installation is removed', async () => {
    mockCodeCliState({ selectedCliTool: CodeCli.GEMINI_CLI })
    versionStatusesMock.mockReturnValue(baseVersionStatuses())

    render(<CodeCliPage />)

    await waitFor(() => expect(selectToolMock).toHaveBeenCalledWith(CodeCli.CLAUDE_CODE))
    expect(screen.queryByText('Gemini CLI')).not.toBeInTheDocument()
  })

  it('shows the discontinuation notice only on the installed Gemini detail page', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.GEMINI_CLI })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.GEMINI_CLI]: { installed: true, source: 'mise' }
      })
    )

    const { unmount } = render(<CodeCliPage />)
    expect(screen.getByText('code.gemini_cli_discontinued')).toBeInTheDocument()
    unmount()

    mockCodeCliState({ selectedCliTool: CodeCli.ANTIGRAVITY_CLI })
    render(<CodeCliPage />)
    expect(screen.queryByText('code.gemini_cli_discontinued')).not.toBeInTheDocument()
  })

  it('keeps launch, upgrade, and uninstall actions available for an installed Gemini CLI', () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.GEMINI_CLI,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new' } },
      currentProviderId: 'anthropic'
    })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.GEMINI_CLI]: { installed: true, source: 'mise', current: '1.0.0', latest: '1.1.0', canUpgrade: true }
      })
    )

    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: 'start tool' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'upgrade tool' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'remove tool' })).toBeInTheDocument()
  })

  it('offers official login and Unified Gateway cards for Antigravity', () => {
    mockProviders.splice(0, mockProviders.length)
    gatewayState.bundle = {
      provider: { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider,
      apiKey: null,
      ensureRunning: vi.fn(),
      getApiKey: vi.fn()
    }
    mockCodeCliState({ selectedCliTool: CodeCli.ANTIGRAVITY_CLI })

    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: `toggle ${CLI_OWN_LOGIN_PROVIDER_ID}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `toggle ${CLI_API_GATEWAY_PROVIDER_ID}` })).toBeInTheDocument()
  })

  it('opens the config dialog instead of auto-selecting the first model when enabling an unconfigured provider', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))

    expect(await screen.findByTestId('config-panel')).toHaveAttribute('data-provider-id', 'anthropic')
    expect(screen.getByTestId('config-panel')).toHaveAttribute('data-model-id', '')
    expect(upsertProviderConfigMock).not.toHaveBeenCalled()
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

  it('opens Hermes Dashboard before the Gateway bootstrap when no default Gateway model exists', async () => {
    const ensureRunning = vi.fn()
    const getApiKey = vi.fn()
    gatewayState.bundle = {
      provider: { ...provider, id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Gateway' },
      apiKey: 'gateway-key',
      ensureRunning,
      getApiKey
    }
    mockCodeCliState({ selectedCliTool: CodeCli.HERMES })
    render(<CodeCliPage />)

    expect(screen.getByTestId('version-status-card')).toHaveAttribute('data-can-launch', 'true')
    fireEvent.click(screen.getByText('start tool'))

    await waitFor(() => expect(ipcRequestMock).toHaveBeenCalledWith('hermes_dashboard.start'))
    expect(ensureRunning).not.toHaveBeenCalled()
    expect(getApiKey).not.toHaveBeenCalled()
    expect(selectFolderMock).not.toHaveBeenCalled()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('code_cli.run', expect.anything())
  })

  it('stores a DeepSeek Harness selection without writing config or starting external services', async () => {
    mockCodeCliState({ selectedCliTool: CodeCli.DEEPSEEK_HARNESS })
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))
    fireEvent.click(await screen.findByText('save model'))

    await waitFor(() => expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic'))
    expect(upsertProviderConfigMock).toHaveBeenCalledWith('anthropic', {
      modelId: 'anthropic::claude-new',
      config: { env: { TEST: 'true' } }
    })
    expect(writeCliConfigDraftMock).not.toHaveBeenCalled()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('deepseek_harness.start', expect.anything())
  })

  it('launches DeepSeek Harness through managed IPC without opening the directory flow', async () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.DEEPSEEK_HARNESS,
      providerConfigs: {
        anthropic: {
          modelId: 'anthropic::claude-new',
          config: { agentPreset: 'code', permissionMode: 'read-only' }
        }
      },
      currentProviderId: 'anthropic'
    })
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'deepseek_harness.get_status') return { status: 'stopped' }
      if (route === 'deepseek_harness.start') return { success: true, url: 'http://127.0.0.1:43123' }
      return { success: true }
    })

    render(<CodeCliPage />)
    fireEvent.click(screen.getByText('start tool'))

    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenCalledWith('deepseek_harness.start', {
        mode: 'direct',
        uniqueModelId: 'anthropic::claude-new',
        agentPreset: 'code',
        permissionMode: 'read-only'
      })
    )
    expect(selectFolderMock).not.toHaveBeenCalled()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('code_cli.run', expect.anything())
  })

  it('locks DeepSeek Harness provider changes and upgrades while its managed process is running', async () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.DEEPSEEK_HARNESS,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.DEEPSEEK_HARNESS]: { current: '1.0.0', latest: '1.1.0', canUpgrade: true }
      })
    )
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'deepseek_harness.get_status') {
        return { status: 'running', url: 'http://127.0.0.1:43123' }
      }
      return { success: true }
    })

    render(<CodeCliPage />)

    const toggleButton = await screen.findByRole('button', { name: 'toggle anthropic' })
    const configureButton = screen.getByRole('button', { name: 'configure anthropic' })
    const upgradeButton = screen.getByRole('button', { name: 'upgrade tool' })
    await waitFor(() => {
      expect(toggleButton).toBeDisabled()
      expect(configureButton).toBeDisabled()
      expect(upgradeButton).toBeDisabled()
    })
    fireEvent.click(toggleButton)
    fireEvent.click(configureButton)
    fireEvent.click(upgradeButton)
    expect(setCurrentProviderMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('config-panel')).not.toBeInTheDocument()
    expect(upgradeMock).not.toHaveBeenCalled()
  })

  it('locks Hermes Agent provider changes and upgrades while its web UI is running', async () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.HERMES,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({ [CodeCli.HERMES]: { current: '1.0.0', latest: '1.1.0', canUpgrade: true } })
    )
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'hermes_dashboard.get_status') return { status: 'running', url: 'http://127.0.0.1:49152' }
      return { success: true }
    })

    render(<CodeCliPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'toggle anthropic' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'configure anthropic' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'upgrade tool' })).toBeDisabled()
    })
  })

  it('locks Hermes Agent provider actions immediately after a cross-window status push', async () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.HERMES,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({ [CodeCli.HERMES]: { current: '1.0.0', latest: '1.1.0', canUpgrade: true } })
    )
    ipcRequestMock.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status') return new Promise(() => {})
      return Promise.resolve({ success: true })
    })
    render(<CodeCliPage />)

    const statusChanged = ipcEventHandlers.get('hermes_dashboard.status_changed')
    if (!statusChanged) throw new Error('Expected Hermes Dashboard status listener')
    await act(async () => {
      statusChanged({ status: 'running', url: 'http://127.0.0.1:49152' })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'toggle anthropic' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'configure anthropic' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'upgrade tool' })).toBeDisabled()
    })
  })

  it('keeps a Hermes cross-window push authoritative over a status poll that answers later', async () => {
    mockCodeCliState({
      selectedCliTool: CodeCli.HERMES,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({ [CodeCli.HERMES]: { current: '1.0.0', latest: '1.1.0', canUpgrade: true } })
    )
    let answerStatusPoll: ((status: { status: string; url?: string }) => void) | undefined
    ipcRequestMock.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status')
        return new Promise((resolve) => {
          answerStatusPoll = resolve
        })
      return Promise.resolve({ success: true })
    })
    render(<CodeCliPage />)

    const statusChanged = ipcEventHandlers.get('hermes_dashboard.status_changed')
    if (!statusChanged) throw new Error('Expected Hermes Dashboard status listener')
    await act(async () => {
      statusChanged({ status: 'running', url: 'http://127.0.0.1:49152' })
    })
    if (!answerStatusPoll) throw new Error('Expected an in-flight Hermes Dashboard status poll')
    await act(async () => {
      answerStatusPoll?.({ status: 'stopped' })
    })

    expect(screen.getByRole('button', { name: 'toggle anthropic' })).toBeDisabled()
  })

  it('enables the provider after saving detailed config from the pending dialog', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))
    fireEvent.click(await screen.findByText('save detailed config'))

    await waitFor(() =>
      expect(upsertProviderConfigMock).toHaveBeenCalledWith('anthropic', {
        modelId: null,
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
          modelId: null,
          config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } }
        }
      }
    })
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))

    await waitFor(() =>
      expect(writeCliConfigDraftMock).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-new',
        configBlob: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } },
        writePrimaryModel: false
      })
    )
    expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic')
  })

  it('does not reorder providers after one is enabled', async () => {
    mockCodeCliState({
      providerConfigs: {
        anthropic: {
          modelId: null,
          config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-new' } }
        }
      }
    })
    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('toggle anthropic'))

    await waitFor(() => expect(setCurrentProviderMock).toHaveBeenCalledWith('anthropic'))
    expect(reorderProvidersMock).not.toHaveBeenCalled()
  })

  it('launches through the unified gateway with the default model when no provider is selected', async () => {
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    const defaultModel = {
      id: 'anthropic::claude-new',
      providerId: 'anthropic',
      modelId: 'claude-new',
      apiModelId: 'claude-new',
      name: 'Claude New'
    }
    const ensureRunning = vi.fn().mockResolvedValue(undefined)
    const getApiKey = vi.fn().mockResolvedValue('cs-sk-default')
    gatewayState.bundle = { provider: gatewayProvider, apiKey: null, ensureRunning, getApiKey }
    gatewayState.defaultModelId = defaultModel.id
    gatewayState.modelsById.set(defaultModel.id, defaultModel)
    mockCodeCliState({ selectedCliTool: CodeCli.OPEN_CODE })

    render(<CodeCliPage />)

    const versionCard = screen.getByTestId('version-status-card')
    expect(versionCard).toHaveAttribute('data-can-launch', 'true')
    expect(versionCard).not.toHaveAttribute('data-launch-disabled-hint')

    fireEvent.click(screen.getByRole('button', { name: 'start tool' }))
    fireEvent.click(await screen.findByRole('button', { name: 'launch tool' }))

    await waitFor(() => expect(getApiKey).toHaveBeenCalledOnce())
    expect(ensureRunning).toHaveBeenCalledOnce()
    expect(writeCliConfigDraftMock).toHaveBeenCalledWith({
      cliTool: CodeCli.OPEN_CODE,
      modelId: defaultModel.id,
      configBlob: undefined,
      writePrimaryModel: true,
      gateway: { provider: gatewayProvider, apiKey: 'cs-sk-default' }
    })
    expect(ipcRequestMock).toHaveBeenCalledWith('code_cli.run', {
      mode: 'normal',
      cliTool: CodeCli.OPEN_CODE,
      model: 'claude-new',
      providerId: 'anthropic',
      gateway: true,
      directory: '/tmp/project',
      terminal: undefined
    })
  })

  it('launches through the unified gateway when the saved provider is no longer supported', async () => {
    const user = userEvent.setup()
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    const defaultModel = {
      id: 'anthropic::claude-new',
      providerId: 'anthropic',
      modelId: 'claude-new',
      apiModelId: 'claude-new',
      name: 'Claude New'
    }
    const ensureRunning = vi.fn().mockResolvedValue(undefined)
    const getApiKey = vi.fn().mockResolvedValue('cs-sk-default')
    gatewayState.bundle = { provider: gatewayProvider, apiKey: null, ensureRunning, getApiKey }
    gatewayState.defaultModelId = defaultModel.id
    gatewayState.modelsById.set(defaultModel.id, defaultModel)
    unsupportedProviderIds.add(provider.id)
    mockCodeCliState({
      providerConfigs: { [provider.id]: { modelId: 'anthropic::kimi-k2.5', config: {} } },
      currentProviderId: provider.id
    })

    render(<CodeCliPage />)

    const startButton = screen.getByRole('button', { name: 'start tool' })
    expect(startButton).toBeEnabled()
    expect(screen.queryByText('anthropic::kimi-k2.5')).not.toBeInTheDocument()

    await user.click(startButton)
    await user.click(await screen.findByRole('button', { name: 'launch tool' }))

    await waitFor(() => expect(getApiKey).toHaveBeenCalledOnce())
    expect(ensureRunning).toHaveBeenCalledOnce()
    expect(writeCliConfigDraftMock).toHaveBeenCalledWith({
      cliTool: CodeCli.CLAUDE_CODE,
      modelId: defaultModel.id,
      configBlob: undefined,
      writePrimaryModel: true,
      gateway: { provider: gatewayProvider, apiKey: 'cs-sk-default' }
    })
    expect(ipcRequestMock).toHaveBeenCalledWith('code_cli.run', {
      mode: 'normal',
      cliTool: CodeCli.CLAUDE_CODE,
      model: 'claude-new',
      providerId: 'anthropic',
      gateway: true,
      directory: '/tmp/project',
      terminal: undefined
    })
  })

  it('waits for provider loading before treating a saved provider as unsupported', () => {
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    gatewayState.bundle = {
      provider: gatewayProvider,
      apiKey: null,
      ensureRunning: vi.fn(),
      getApiKey: vi.fn()
    }
    gatewayState.defaultModelId = 'anthropic::claude-new'
    gatewayState.modelsById.set('anthropic::claude-new', {
      id: 'anthropic::claude-new',
      providerId: 'anthropic',
      modelId: 'claude-new',
      apiModelId: 'claude-new',
      name: 'Claude New'
    })
    providersLoadingState.value = true
    mockProviders.splice(0, mockProviders.length)
    mockCodeCliState({
      providerConfigs: { [provider.id]: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: provider.id
    })

    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: 'start tool' })).toBeDisabled()
  })

  it('does not re-read CLI config after fallback gateway connection state updates', async () => {
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    const defaultModel = {
      id: 'anthropic::claude-new',
      providerId: 'anthropic',
      modelId: 'claude-new',
      apiModelId: 'claude-new',
      name: 'Claude New'
    }
    let resolveFirstRead!: (files: CliConfigFileDraft[]) => void
    const pendingRead = new Promise<CliConfigFileDraft[]>(() => {})
    readCliConfigFilesMock
      .mockImplementationOnce(
        () =>
          new Promise<CliConfigFileDraft[]>((resolve) => {
            resolveFirstRead = resolve
          })
      )
      .mockReturnValue(pendingRead)
    extractConnectionFromCliConfigDraftMock.mockReturnValue({ model: 'other-provider:other-model' })
    cliConfigConnectionMatchesProviderMock.mockReturnValue(false)
    gatewayState.bundle = {
      provider: gatewayProvider,
      apiKey: null,
      ensureRunning: vi.fn(),
      getApiKey: vi.fn()
    }
    gatewayState.defaultModelId = defaultModel.id
    gatewayState.modelsById.set(defaultModel.id, defaultModel)
    mockCodeCliState({ selectedCliTool: CodeCli.OPEN_CODE })

    render(<CodeCliPage />)
    expect(readCliConfigFilesMock).toHaveBeenCalledOnce()

    resolveFirstRead(cliConfigFiles)
    await waitFor(() => expect(extractConnectionFromCliConfigDraftMock).toHaveBeenCalledOnce())

    expect(readCliConfigFilesMock).toHaveBeenCalledOnce()
  })

  it('opens unified gateway configuration when no routable default model is available', async () => {
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    gatewayState.bundle = {
      provider: gatewayProvider,
      apiKey: null,
      ensureRunning: vi.fn().mockResolvedValue(undefined),
      getApiKey: vi.fn().mockResolvedValue('cs-sk-default')
    }
    mockCodeCliState({ selectedCliTool: CodeCli.OPEN_CODE })

    render(<CodeCliPage />)

    const startButton = screen.getByRole('button', { name: 'start tool' })
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    expect(await screen.findByTestId('config-panel')).toHaveAttribute('data-provider-id', CLI_API_GATEWAY_PROVIDER_ID)
    expect(screen.queryByRole('button', { name: 'launch tool' })).not.toBeInTheDocument()
  })

  it('shows the Anthropic Messages endpoint hint for Claude Code provider setup', () => {
    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: /code.add_provider_hint_anthropic_messages/ })).toBeInTheDocument()
  })

  it('opens the provider settings tab (keeping the code page) from the add-provider hint', () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByRole('button', { name: /code.add_provider_hint_anthropic_messages/ }))

    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/provider')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows the OpenAI Responses endpoint hint for Codex provider setup', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.OPENAI_CODEX })

    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: /code.add_provider_hint_openai_responses/ })).toBeInTheDocument()
  })

  it('shows the generic provider setup hint for other provider-backed tools', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.OPEN_CODE })

    render(<CodeCliPage />)

    expect(screen.getByRole('button', { name: /code.add_provider_hint/ })).toBeInTheDocument()
    expect(screen.queryByText('code.add_provider_hint_anthropic_messages')).not.toBeInTheDocument()
    expect(screen.queryByText('code.add_provider_hint_openai_responses')).not.toBeInTheDocument()
  })

  it('removes the launch hint once a current provider is selected', () => {
    mockCodeCliState({
      providerConfigs: {
        anthropic: { modelId: 'anthropic::claude-new', config: {} }
      },
      currentProviderId: 'anthropic'
    })

    render(<CodeCliPage />)

    const versionCard = screen.getByTestId('version-status-card')
    expect(versionCard).toHaveAttribute('data-can-launch', 'true')
    expect(versionCard).not.toHaveAttribute('data-launch-disabled-hint')
  })

  it('does not add a provider selection hint for provider-less tools', () => {
    mockCodeCliState({ selectedCliTool: CodeCli.QODER_CLI })

    render(<CodeCliPage />)

    expect(screen.queryByText('code.add_provider_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.add_provider_hint_anthropic_messages')).not.toBeInTheDocument()
    expect(screen.queryByText('code.add_provider_hint_openai_responses')).not.toBeInTheDocument()
    const versionCard = screen.getByTestId('version-status-card')
    expect(versionCard).toHaveAttribute('data-can-launch', 'true')
    expect(versionCard).not.toHaveAttribute('data-launch-disabled-hint')
  })

  it('offers the own-login entry (and no selection hint) when no real providers exist', () => {
    mockProviders.splice(0, mockProviders.length)
    mockCodeCliState()

    render(<CodeCliPage />)

    // Login-capable tools always surface the virtual own-login row, so there is no empty state and
    // the "select a provider" hint is suppressed (own-login is the only option, nothing to nag about).
    expect(screen.queryByTestId('empty-config-list')).not.toBeInTheDocument()
    expect(screen.getByText(`toggle ${CLI_OWN_LOGIN_PROVIDER_ID}`)).toBeInTheDocument()
    expect(screen.getByTestId('version-status-card')).not.toHaveAttribute('data-launch-disabled-hint')
  })

  it('warns that credentials may remain when clearing the CLI config fails during tool removal', async () => {
    mockCodeCliState({
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    removeMock.mockResolvedValue(true)
    clearCliConfigMock.mockRejectedValue(new Error('EACCES'))

    render(<CodeCliPage />)

    fireEvent.click(screen.getByText('remove tool'))
    fireEvent.click(await screen.findByText('confirm remove'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('code.clear_config_failed'))
    // The in-app cleanup still proceeds so the tool state does not point at a removed provider.
    expect(setCurrentProviderMock).toHaveBeenCalledWith(null)
  })

  it('stops the managed DeepSeek Harness process before uninstalling and only then clears CodeMate selection', async () => {
    const events: string[] = []
    mockCodeCliState({
      selectedCliTool: CodeCli.DEEPSEEK_HARNESS,
      providerConfigs: { anthropic: { modelId: 'anthropic::claude-new', config: {} } },
      currentProviderId: 'anthropic'
    })
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'deepseek_harness.get_status') return { status: 'running', url: 'http://127.0.0.1:43123' }
      if (route === 'deepseek_harness.stop') {
        events.push('stop')
        return { success: true }
      }
      return { success: true }
    })
    removeMock.mockImplementation(async () => {
      events.push('remove')
      return true
    })
    setCurrentProviderMock.mockImplementation(async () => {
      events.push('clear-selection')
    })

    render(<CodeCliPage />)
    fireEvent.click(screen.getByText('remove tool'))
    fireEvent.click(await screen.findByText('confirm remove'))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith(CodeCli.DEEPSEEK_HARNESS))
    expect(events).toEqual(['stop', 'remove', 'clear-selection'])
    expect(clearCliConfigMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed install as an install-error dialog but not a failed uninstall', () => {
    // A failed install exposes the error affordance, and opening it shows the install-error dialog.
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.CLAUDE_CODE]: { operation: { status: 'failed', action: 'install', error: 'install boom' } }
      })
    )
    const { unmount } = render(<CodeCliPage />)

    fireEvent.click(screen.getByText('show error'))
    expect(screen.getByRole('dialog')).toHaveTextContent('settings.dependencies.installError')

    unmount()

    // A failed uninstall must not masquerade as an install error — the remove path has its own toast.
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.CLAUDE_CODE]: { operation: { status: 'failed', action: 'remove', error: 'remove boom' } }
      })
    )
    render(<CodeCliPage />)

    expect(screen.queryByText('show error')).not.toBeInTheDocument()
  })

  it('does not auto-reopen the install-error dialog after switching tools and back', () => {
    versionStatusesMock.mockReturnValue(
      baseVersionStatuses({
        [CodeCli.CLAUDE_CODE]: { operation: { status: 'failed', action: 'install', error: 'boom' } }
      })
    )
    const { rerender } = render(<CodeCliPage />)

    fireEvent.click(screen.getByText('show error'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Switch to a tool with no failed install: the dialog's controlled `open` goes false, but Radix
    // does not fire onOpenChange on a controlled close (the mocked Dialog reproduces this).
    mockCodeCliState({ selectedCliTool: CodeCli.OPENAI_CODEX })
    rerender(<CodeCliPage />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Switch back to the failed tool. Without resetting on tool change, the stale open flag would
    // re-surface the dialog unprompted.
    mockCodeCliState({ selectedCliTool: CodeCli.CLAUDE_CODE })
    rerender(<CodeCliPage />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
