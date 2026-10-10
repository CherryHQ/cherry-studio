import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  availableTerminals: [] as { id: string; name: string }[],
  requestMock: vi.fn(),
  resolveCliConfigApplyContext: vi.fn(),
  writeCliConfigDraft: vi.fn(),
  readCliConfigFiles: vi.fn(),
  extractConnectionFromCliConfigDraft: vi.fn(),
  extractConfigFromCliConfigDraft: vi.fn(),
  gatewayExpectedModel: vi.fn(),
  gatewayModelIdFromAddress: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.requestMock }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Relative to THIS file (hooks/__tests__/), so two levels up — the hook's own
// '../cliConfig' resolves to the same barrel. A '../cliConfig' here would point
// at the non-existent hooks/cliConfig and silently mock nothing.
vi.mock('../../cliConfig', () => ({
  resolveCliConfigApplyContext: mocks.resolveCliConfigApplyContext,
  writeCliConfigDraft: mocks.writeCliConfigDraft,
  readCliConfigFiles: mocks.readCliConfigFiles,
  extractConnectionFromCliConfigDraft: mocks.extractConnectionFromCliConfigDraft,
  extractConfigFromCliConfigDraft: mocks.extractConfigFromCliConfigDraft,
  gatewayExpectedModel: mocks.gatewayExpectedModel,
  gatewayModelIdFromAddress: mocks.gatewayModelIdFromAddress
}))

vi.mock('../useAvailableTerminals', () => ({
  useAvailableTerminals: () => mocks.availableTerminals
}))

const { useLaunchDialogController } = await import('../useLaunchDialogController')

const enabledProvider = { id: 'anthropic', name: 'Anthropic' } as Provider

describe('useLaunchDialogController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.availableTerminals = [
      { id: 'terminal', name: 'Terminal' },
      { id: 'iterm2', name: 'iTerm2' }
    ]
    mocks.requestMock.mockResolvedValue({ success: true, message: '' })
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      rawModelId: 'claude-sonnet-4-5',
      writePrimaryModel: true
    })
  })

  // Regression: the picker (CurrentConfigPanel) falls back to `terminals[0]` for display when the
  // user has never picked one, but launch used to send the raw (unresolved) preference — silently
  // launching a different terminal than the one shown as selected.
  it('resolves the picker fallback into the launch payload instead of sending undefined', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        selectedTerminal: undefined,
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    expect(result.current.launchDialogProps.selectedTerminal).toBe('terminal')

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', terminal: 'terminal' })
    )
  })

  it('uses the persisted terminal for both display and launch once the user has picked one', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        selectedTerminal: 'iterm2',
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    expect(result.current.launchDialogProps.selectedTerminal).toBe('iterm2')

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', terminal: 'iterm2' })
    )
  })

  // The run payload's `gateway` flag is derived from the enabled provider: a CLI (here gemini-cli)
  // launched against the synthetic gateway provider must send gateway: true so the main process
  // addresses the model as providerId:apiModelId (+ sentinel); a regular provider sends false.
  it('sends gateway: true when launching against the API gateway provider', async () => {
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: `${CLI_API_GATEWAY_PROVIDER_ID}::deepseek:deepseek-chat`,
      providerId: CLI_API_GATEWAY_PROVIDER_ID,
      rawModelId: 'deepseek:deepseek-chat',
      writePrimaryModel: true
    })
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.GEMINI_CLI,
        toolName: 'Gemini CLI',
        directory: '/tmp/project',
        enabledProvider: { id: CLI_API_GATEWAY_PROVIDER_ID, name: '统一网关' } as Provider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: `${CLI_API_GATEWAY_PROVIDER_ID}::deepseek:deepseek-chat` },
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map<UniqueModelId, Model>([
          [`${CLI_API_GATEWAY_PROVIDER_ID}::deepseek:deepseek-chat`, { apiModelId: 'deepseek:deepseek-chat' } as Model]
        ]),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', gateway: true, providerId: CLI_API_GATEWAY_PROVIDER_ID })
    )
  })

  // A direct launch hands `--model` straight to the provider's own API, which only knows the
  // model by its apiModelId — an aliased model would be launched under a name it never sees.
  it('launches a direct model under its apiModelId, not its internal id', async () => {
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: 'anthropic::my-alias',
      providerId: 'anthropic',
      rawModelId: 'my-alias',
      writePrimaryModel: true
    })
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.ANTIGRAVITY_CLI,
        toolName: 'Antigravity CLI',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::my-alias' },
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::my-alias', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', gateway: false, model: 'claude-sonnet-4-5' })
    )
  })

  // Reviewer: falling back to the raw id on a miss is only safe when the record exists and
  // simply has no apiModelId. A miss because the query is cold, or because the saved model was
  // later disabled, would hand the provider an internal id it has never heard of.
  it.each([
    ['the model query has not settled yet', true, new Map<UniqueModelId, Model>()],
    ['the saved model is no longer enabled', false, new Map<UniqueModelId, Model>()]
  ])('does not launch a direct model when %s', async (_label, isModelsLoading, modelById) => {
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: 'anthropic::my-alias',
      providerId: 'anthropic',
      rawModelId: 'my-alias',
      writePrimaryModel: true
    })
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.ANTIGRAVITY_CLI,
        toolName: 'Antigravity CLI',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::my-alias' },
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map(),
        modelById,
        isModelsLoading,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).not.toHaveBeenCalled()
  })

  // A record that exists but carries no apiModelId is a genuine raw-id case, not a stale selection.
  it('falls back to the raw id when the record exists without an apiModelId', async () => {
    mocks.resolveCliConfigApplyContext.mockReturnValue({
      modelId: 'anthropic::my-alias',
      providerId: 'anthropic',
      rawModelId: 'my-alias',
      writePrimaryModel: true
    })
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.ANTIGRAVITY_CLI,
        toolName: 'Antigravity CLI',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::my-alias' },
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([['anthropic::my-alias', {} as Model]]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', model: 'my-alias' })
    )
  })

  it('sends gateway: false for a regular (non-gateway) provider', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'normal', gateway: false })
    )
  })

  it('keeps the existing null-context cleanup for a regular provider', async () => {
    mocks.resolveCliConfigApplyContext.mockReturnValue(null)
    const upsertProviderConfig = vi.fn().mockResolvedValue('anthropic')
    const setCurrentProvider = vi.fn().mockResolvedValue(undefined)
    const currentProviderConfig = { modelId: null }
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.CLAUDE_CODE,
        toolName: 'Claude Code',
        directory: '/tmp/project',
        enabledProvider,
        isOwnLoginSelected: false,
        currentProviderConfig,
        selectedTerminal: 'terminal',
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig,
        setCurrentProvider,
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.resolveCliConfigApplyContext).toHaveBeenCalledWith(
      CodeCli.CLAUDE_CODE,
      'anthropic',
      currentProviderConfig,
      undefined
    )
    expect(upsertProviderConfig).toHaveBeenCalledWith('anthropic', { modelId: null })
    expect(setCurrentProvider).toHaveBeenCalledWith(null)
    expect(mocks.requestMock).not.toHaveBeenCalled()
  })

  it('resolves the same fallback for provider-less launches', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.QODER_CLI,
        toolName: 'Qoder',
        directory: '/tmp/project',
        isOwnLoginSelected: false,
        selectedTerminal: undefined,
        gatewayModelsById: new Map(),
        modelById: new Map<UniqueModelId, Model>([
          ['anthropic::claude-sonnet-4-5', { apiModelId: 'claude-sonnet-4-5' } as Model]
        ]),
        isModelsLoading: false,
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
        setTerminal: vi.fn(),
        selectFolder: vi.fn()
      })
    )

    await act(async () => {
      result.current.launchDialogProps.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith(
      'code_cli.run',
      expect.objectContaining({ mode: 'own-login', terminal: 'terminal' })
    )
  })

  // Reviewer: launch previously ran the CLI without re-checking the gateway, so a stopped
  // gateway (or a re-keyed/re-ported one) launched against a dead endpoint or stale on-disk
  // credentials. The gateway must be re-verified and the config rewritten before every launch.
  describe('cherry gateway launch', () => {
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: '统一网关' } as Provider
    const managedModel = {
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat'
    } as unknown as Model
    const gatewayModelsById = new Map<UniqueModelId, Model>([[managedModel.id, managedModel]])

    function renderGatewayLaunch(
      getApiKey: ReturnType<typeof vi.fn<(...args: any[]) => any>>,
      availableModels: Map<UniqueModelId, Model> = gatewayModelsById,
      ensureRunning: ReturnType<typeof vi.fn<(...args: any[]) => any>> = vi.fn().mockResolvedValue(undefined),
      selectedCliTool: CodeCli = CodeCli.CLAUDE_CODE
    ) {
      const upsertProviderConfig = vi.fn().mockResolvedValue(CLI_API_GATEWAY_PROVIDER_ID)
      const setCurrentProvider = vi.fn().mockResolvedValue(undefined)
      const rendered = renderHook(() =>
        useLaunchDialogController({
          selectedCliTool,
          toolName: 'Claude Code',
          directory: '/tmp/project',
          enabledProvider: gatewayProvider,
          isOwnLoginSelected: false,
          currentProviderConfig: { modelId: 'deepseek::deepseek-chat', config: { permissionMode: 'plan' } },
          selectedTerminal: 'terminal',
          apiGatewayProvider: { provider: gatewayProvider, apiKey: 'cs-sk-old', ensureRunning, getApiKey },
          gatewayModelsById: availableModels,
          modelById: new Map<UniqueModelId, Model>(),
          isModelsLoading: false,
          upsertProviderConfig,
          setCurrentProvider,
          setTerminal: vi.fn(),
          selectFolder: vi.fn()
        })
      )
      return { ...rendered, upsertProviderConfig, setCurrentProvider, ensureRunning }
    }

    beforeEach(() => {
      mocks.writeCliConfigDraft.mockResolvedValue(undefined)
      mocks.resolveCliConfigApplyContext.mockReturnValue({
        modelId: 'deepseek::deepseek-chat',
        providerId: 'deepseek',
        rawModelId: 'deepseek-chat',
        writePrimaryModel: true
      })
      // Default: no on-disk config to read back → treated as managed (rewrite proceeds).
      mocks.readCliConfigFiles.mockResolvedValue([])
      mocks.extractConnectionFromCliConfigDraft.mockReturnValue(null)
      mocks.extractConfigFromCliConfigDraft.mockReturnValue(null)
      mocks.gatewayExpectedModel.mockReturnValue('deepseek:deepseek-chat')
      mocks.gatewayModelIdFromAddress.mockReturnValue(undefined)
    })

    it('keeps the gateway selection when its detailed model cannot be resolved', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      mocks.resolveCliConfigApplyContext.mockReturnValue(null)
      const { result, upsertProviderConfig, setCurrentProvider } = renderGatewayLaunch(getApiKey)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.resolveCliConfigApplyContext).toHaveBeenCalledWith(
        CodeCli.CLAUDE_CODE,
        CLI_API_GATEWAY_PROVIDER_ID,
        { modelId: 'deepseek::deepseek-chat', config: { permissionMode: 'plan' } },
        gatewayModelsById
      )
      expect(upsertProviderConfig).not.toHaveBeenCalled()
      expect(setCurrentProvider).not.toHaveBeenCalled()
      expect(getApiKey).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    it('re-verifies the gateway and rewrites the config with its key before running', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const { result } = renderGatewayLaunch(getApiKey)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        // handleLaunch chains startup → key read → write → run; flush the whole chain.
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(getApiKey).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { permissionMode: 'plan' },
        writePrimaryModel: true,
        gateway: { provider: gatewayProvider, apiKey: 'cs-sk-current' }
      })
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
      // The rebuild must complete before the CLI is spawned.
      expect(mocks.writeCliConfigDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.requestMock.mock.invocationCallOrder[0]
      )
    })

    // Antigravity is not file-configured, so the reconciliation block — and the membership check
    // that used to live inside it — never ran for it: a stale selection started a session that
    // the gateway only rejects on the CLI's first request, after all the startup side effects.
    it('does not start a non-file-configured CLI when its gateway model is gone', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const ensureRunning = vi.fn().mockResolvedValue(undefined)
      const { result } = renderGatewayLaunch(getApiKey, new Map(), ensureRunning, CodeCli.ANTIGRAVITY_CLI)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureRunning).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    // The gateway matches an address against each model's apiModelId, so launching a renamed
    // model under its internal id makes the request unroutable.
    it('launches a gateway model under its apiModelId, not its internal id', async () => {
      const renamedModel = {
        id: 'deepseek::my-deepseek',
        providerId: 'deepseek',
        apiModelId: 'deepseek-chat'
      } as unknown as Model
      mocks.resolveCliConfigApplyContext.mockReturnValue({
        modelId: 'deepseek::my-deepseek',
        providerId: 'deepseek',
        rawModelId: 'my-deepseek',
        writePrimaryModel: true
      })
      const { result } = renderGatewayLaunch(
        vi.fn().mockResolvedValue('cs-sk-current'),
        new Map<UniqueModelId, Model>([[renamedModel.id, renamedModel]]),
        vi.fn().mockResolvedValue(undefined),
        CodeCli.ANTIGRAVITY_CLI
      )

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.requestMock).toHaveBeenCalledWith(
        'code_cli.run',
        expect.objectContaining({ mode: 'normal', gateway: true, model: 'deepseek-chat' })
      )
    })

    it('does not run the CLI when the gateway fails to start', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const ensureRunning = vi.fn().mockRejectedValue(new Error('API gateway failed to start'))
      const { result } = renderGatewayLaunch(getApiKey, gatewayModelsById, ensureRunning)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(getApiKey).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
      expect(result.current.launching).toBe(false)
    })

    it('launches Antigravity after ensuring the gateway runs without reading its key or writing config', async () => {
      const getApiKey = vi.fn().mockRejectedValue(new Error('key should not be read'))
      const ensureRunning = vi.fn().mockResolvedValue(undefined)
      const { result } = renderGatewayLaunch(getApiKey, gatewayModelsById, ensureRunning, CodeCli.ANTIGRAVITY_CLI)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureRunning).toHaveBeenCalledTimes(1)
      expect(getApiKey).not.toHaveBeenCalled()
      expect(mocks.readCliConfigFiles).not.toHaveBeenCalled()
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).toHaveBeenCalledWith(
        'code_cli.run',
        expect.objectContaining({ cliTool: CodeCli.ANTIGRAVITY_CLI, gateway: true })
      )
    })

    it('does not launch when the managed gateway model is no longer available', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const { result } = renderGatewayLaunch(getApiKey, new Map())

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      // Nothing may run before the membership check — reading the key persists a freshly
      // generated one, a side effect a launch that cannot route must not leave behind.
      expect(getApiKey).not.toHaveBeenCalled()
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    // A foreign/raw gateway draft may intentionally select a different gateway model. Reconcile the
    // managed endpoint/key before launch while preserving that model and the raw tool parameters.
    it('reconciles a foreign gateway config while preserving its model', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const files = [{ target: 'claude-settings', content: '{}' }]
      mocks.readCliConfigFiles.mockResolvedValue(files)
      mocks.extractConnectionFromCliConfigDraft.mockReturnValue({ model: 'deepseek:deepseek-reasoner' })
      mocks.extractConfigFromCliConfigDraft.mockReturnValue({ permissionMode: 'acceptEdits' })
      mocks.gatewayExpectedModel.mockReturnValue('deepseek:deepseek-chat')
      mocks.gatewayModelIdFromAddress.mockReturnValue('deepseek::deepseek-reasoner')
      const foreignModel = {
        id: 'deepseek::deepseek-reasoner',
        providerId: 'deepseek',
        apiModelId: 'deepseek-reasoner'
      } as unknown as Model
      const availableModels = new Map(gatewayModelsById).set(foreignModel.id, foreignModel)
      const { result } = renderGatewayLaunch(getApiKey, availableModels)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(getApiKey).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'deepseek::deepseek-reasoner',
        configBlob: { permissionMode: 'acceptEdits' },
        files,
        writePrimaryModel: true,
        gateway: { provider: gatewayProvider, apiKey: 'cs-sk-current' }
      })
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })

    it('does not launch an unresolvable foreign gateway model with stale credentials', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      mocks.readCliConfigFiles.mockResolvedValue([{ target: 'claude-settings', content: '{}' }])
      mocks.extractConnectionFromCliConfigDraft.mockReturnValue({ model: 'removed:model' })
      mocks.gatewayExpectedModel.mockReturnValue('deepseek:deepseek-chat')
      mocks.gatewayModelIdFromAddress.mockReturnValue(undefined)
      const { result } = renderGatewayLaunch(getApiKey)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(getApiKey).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    // Reading preserves raw gateway choices during reconciliation. If it fails, rebuild from the
    // managed preference rather than launching with stale connection details.
    it('rewrites and launches when the reconciliation read fails', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      mocks.readCliConfigFiles.mockRejectedValue(new Error('EACCES: permission denied'))
      const { result } = renderGatewayLaunch(getApiKey)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.writeCliConfigDraft).toHaveBeenCalledTimes(1)
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })

    it('does not touch the gateway for a real-provider launch', async () => {
      const getApiKey = vi.fn().mockResolvedValue('cs-sk-current')
      const { result } = renderHook(() =>
        useLaunchDialogController({
          selectedCliTool: CodeCli.CLAUDE_CODE,
          toolName: 'Claude Code',
          directory: '/tmp/project',
          enabledProvider,
          isOwnLoginSelected: false,
          currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
          selectedTerminal: 'terminal',
          apiGatewayProvider: {
            provider: gatewayProvider,
            apiKey: 'cs-sk-old',
            ensureRunning: vi.fn(),
            getApiKey
          },
          gatewayModelsById: new Map(),
          // This block's beforeEach resolves the context to deepseek::deepseek-chat.
          modelById: new Map<UniqueModelId, Model>([
            ['deepseek::deepseek-chat', { apiModelId: 'deepseek-chat' } as Model]
          ]),
          isModelsLoading: false,
          upsertProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
          setTerminal: vi.fn(),
          selectFolder: vi.fn()
        })
      )

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(getApiKey).not.toHaveBeenCalled()
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })
  })
})
