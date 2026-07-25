import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
        gatewayModelsById: new Map(),
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

  it('resolves the same fallback for provider-less launches', async () => {
    const { result } = renderHook(() =>
      useLaunchDialogController({
        selectedCliTool: CodeCli.QODER_CLI,
        toolName: 'Qoder',
        directory: '/tmp/project',
        isOwnLoginSelected: false,
        selectedTerminal: undefined,
        gatewayModelsById: new Map(),
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
      ensureReady: ReturnType<typeof vi.fn>,
      availableModels: Map<UniqueModelId, Model> = gatewayModelsById
    ) {
      return renderHook(() =>
        useLaunchDialogController({
          selectedCliTool: CodeCli.CLAUDE_CODE,
          toolName: 'Claude Code',
          directory: '/tmp/project',
          enabledProvider: gatewayProvider,
          isOwnLoginSelected: false,
          currentProviderConfig: { modelId: 'deepseek::deepseek-chat', config: { permissionMode: 'plan' } },
          selectedTerminal: 'terminal',
          apiGatewayProvider: { provider: gatewayProvider, apiKey: 'cs-sk-old', ensureReady },
          gatewayModelsById: availableModels,
          upsertProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
          setTerminal: vi.fn(),
          selectFolder: vi.fn()
        })
      )
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

    it('re-verifies the gateway and rewrites the config with the fresh key before running', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
      const { result } = renderGatewayLaunch(ensureReady)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        // handleLaunch chains ensureReady → write → run; flush the whole chain.
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureReady).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { permissionMode: 'plan' },
        writePrimaryModel: true,
        gateway: { provider: gatewayProvider, apiKey: 'cs-sk-fresh' }
      })
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
      // The rebuild must complete before the CLI is spawned.
      expect(mocks.writeCliConfigDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.requestMock.mock.invocationCallOrder[0]
      )
    })

    it('does not run the CLI when the gateway fails to start', async () => {
      const ensureReady = vi.fn().mockRejectedValue(new Error('API gateway failed to start'))
      const { result } = renderGatewayLaunch(ensureReady)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
      expect(result.current.launching).toBe(false)
    })

    it('does not launch when the managed gateway model is no longer available', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
      const { result } = renderGatewayLaunch(ensureReady, new Map())

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureReady).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    // A foreign/raw gateway draft may intentionally select a different gateway model. Refresh the
    // managed endpoint/key before launch while preserving that model and the raw tool parameters.
    it('refreshes a foreign gateway config with the fresh connection while preserving its model', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
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
      const { result } = renderGatewayLaunch(ensureReady, availableModels)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureReady).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'deepseek::deepseek-reasoner',
        configBlob: { permissionMode: 'acceptEdits' },
        files,
        writePrimaryModel: true,
        gateway: { provider: gatewayProvider, apiKey: 'cs-sk-fresh' }
      })
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })

    it('does not launch an unresolvable foreign gateway model with stale credentials', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
      mocks.readCliConfigFiles.mockResolvedValue([{ target: 'claude-settings', content: '{}' }])
      mocks.extractConnectionFromCliConfigDraft.mockReturnValue({ model: 'removed:model' })
      mocks.gatewayExpectedModel.mockReturnValue('deepseek:deepseek-chat')
      mocks.gatewayModelIdFromAddress.mockReturnValue(undefined)
      const { result } = renderGatewayLaunch(ensureReady)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(ensureReady).toHaveBeenCalledTimes(1)
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).not.toHaveBeenCalled()
    })

    // Reading preserves raw gateway choices during reconciliation. If it fails, rebuild from the
    // managed preference rather than launching with stale connection details.
    it('rewrites and launches when the reconciliation read fails', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
      mocks.readCliConfigFiles.mockRejectedValue(new Error('EACCES: permission denied'))
      const { result } = renderGatewayLaunch(ensureReady)

      await act(async () => {
        result.current.launchDialogProps.onLaunch()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mocks.writeCliConfigDraft).toHaveBeenCalledTimes(1)
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })

    it('does not touch the gateway for a real-provider launch', async () => {
      const ensureReady = vi.fn().mockResolvedValue('cs-sk-fresh')
      const { result } = renderHook(() =>
        useLaunchDialogController({
          selectedCliTool: CodeCli.CLAUDE_CODE,
          toolName: 'Claude Code',
          directory: '/tmp/project',
          enabledProvider,
          isOwnLoginSelected: false,
          currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
          selectedTerminal: 'terminal',
          apiGatewayProvider: { provider: gatewayProvider, apiKey: 'cs-sk-old', ensureReady },
          gatewayModelsById: new Map(),
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

      expect(ensureReady).not.toHaveBeenCalled()
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(mocks.requestMock).toHaveBeenCalledWith('code_cli.run', expect.objectContaining({ mode: 'normal' }))
    })
  })
})
