import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractConnectionFromCliConfigDraft: vi.fn(),
  readCliConfigFiles: vi.fn(),
  readCliConfigDraft: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/pages/code/cliConfig', async (importOriginal) => {
  // oxlint-disable-next-line consistent-type-imports
  const actual = await importOriginal<typeof import('@renderer/pages/code/cliConfig')>()
  return {
    ...actual,
    extractConnectionFromCliConfigDraft: mocks.extractConnectionFromCliConfigDraft,
    readCliConfigFiles: mocks.readCliConfigFiles,
    readCliConfigDraft: mocks.readCliConfigDraft,
    updateCliConfigDraftConfig: vi.fn(),
    validateCliConfigDraftForWrite: vi.fn()
  }
})

const { useConfigDraftController } = await import('../useConfigDraftController')

const codexProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.deepseek.com/v1' } },
  defaultChatEndpoint: 'openai-responses'
} as unknown as Provider

const rawFiles: CliConfigFileDraft[] = [
  { target: 'codex-config', label: 'Codex config', path: '/home/.codex/config.toml', language: 'toml', content: '' }
]

// A connection whose baseUrl/model match the enabled provider but whose apiKey does not —
// the exact shape `connectionMatchesProvider` must reject once `apiKeys` has actually resolved.
const foreignConnection: CliConfigConnection = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-foreign',
  model: 'deepseek-chat'
}

function renderController(
  apiKeys: ApiKeyEntry[] | undefined,
  handlers: {
    onSubmit?: ReturnType<typeof vi.fn>
    onClose?: ReturnType<typeof vi.fn>
    isCurrentProvider?: boolean
  } = {}
) {
  return renderHook(
    (props: { apiKeys: ApiKeyEntry[] | undefined }) =>
      useConfigDraftController({
        cliTool: CodeCli.OPENAI_CODEX,
        provider: codexProvider,
        providerConfig: { modelId: 'deepseek::deepseek-chat' },
        isCurrentProvider: handlers.isCurrentProvider ?? true,
        apiKeys: props.apiKeys,
        onSubmit: handlers.onSubmit ?? vi.fn(),
        onClose: handlers.onClose ?? vi.fn()
      }),
    { initialProps: { apiKeys } }
  )
}

describe('useConfigDraftController (initial load vs. apiKeys race)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCliConfigFiles.mockResolvedValue(rawFiles)
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue(foreignConnection)
  })

  it('does not judge managed/foreign until the apiKeys query resolves', async () => {
    const { result } = renderController(undefined)

    // Flush any pending microtasks; the load effect must not have fired at all.
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.readCliConfigFiles).not.toHaveBeenCalled()
    expect(result.current.draft.mode).toBe('managed')
  })

  it('judges foreign correctly once apiKeys resolves to a non-matching set', async () => {
    const { result, rerender } = renderController(undefined)

    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.readCliConfigFiles).not.toHaveBeenCalled()

    rerender({ apiKeys: [{ id: 'k1', key: 'sk-real', isEnabled: true }] })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.readCliConfigFiles).toHaveBeenCalledTimes(1)
    expect(result.current.draft.mode).toBe('foreign')
  })

  it('does not re-run the initial load when apiKeys changes reference after it already ran', async () => {
    const { rerender } = renderController([{ id: 'k1', key: 'sk-real', isEnabled: true }])

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.readCliConfigFiles).toHaveBeenCalledTimes(1)

    // New array reference, same content — must not trigger a second load.
    rerender({ apiKeys: [{ id: 'k1', key: 'sk-real', isEnabled: true }] })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.readCliConfigFiles).toHaveBeenCalledTimes(1)
  })
})

describe('useConfigDraftController (cherry gateway)', () => {
  const GATEWAY_BASE_URL = 'http://127.0.0.1:23333'
  const gatewayProvider = {
    id: CLI_API_GATEWAY_PROVIDER_ID,
    name: '统一网关',
    endpointConfigs: {
      'anthropic-messages': { baseUrl: GATEWAY_BASE_URL },
      'openai-chat-completions': { baseUrl: GATEWAY_BASE_URL },
      'openai-responses': { baseUrl: GATEWAY_BASE_URL }
    },
    defaultChatEndpoint: 'anthropic-messages'
  } as unknown as Provider
  const gateway = { provider: gatewayProvider, apiKey: 'cs-sk-gateway' }
  const gatewayModels = new Map<UniqueModelId, Model>([
    ['deepseek::deepseek-chat', { apiModelId: 'deepseek-chat' } as Model]
  ])
  // What a gateway-written config parses back to: gateway URL + gateway key +
  // gateway-addressed model ("providerId:apiModelId", single colon).
  const gatewayConnection: CliConfigConnection = {
    baseUrl: GATEWAY_BASE_URL,
    apiKey: 'cs-sk-gateway',
    model: 'deepseek:deepseek-chat'
  }
  const gatewayRawFiles: CliConfigFileDraft[] = [
    {
      target: 'claude-settings',
      label: 'Claude settings.json',
      path: '/home/.claude/settings.json',
      language: 'json',
      content: '{}'
    }
  ]

  function renderGatewayController(
    providerConfig: { modelId: UniqueModelId | null } = { modelId: 'deepseek::deepseek-chat' },
    handlers: { onSubmit?: ReturnType<typeof vi.fn>; onClose?: ReturnType<typeof vi.fn> } = {}
  ) {
    return renderHook(() =>
      useConfigDraftController({
        cliTool: CodeCli.CLAUDE_CODE,
        provider: gatewayProvider,
        providerConfig,
        isCurrentProvider: true,
        apiKeys: [{ id: 'gateway', key: 'cs-sk-gateway', isEnabled: true }],
        gateway,
        models: gatewayModels,
        onSubmit: handlers.onSubmit ?? vi.fn(),
        onClose: handlers.onClose ?? vi.fn()
      })
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCliConfigFiles.mockResolvedValue(gatewayRawFiles)
    mocks.readCliConfigDraft.mockResolvedValue(gatewayRawFiles)
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue(gatewayConnection)
  })

  it('threads the gateway context into the initial managed preview rebuild', async () => {
    renderGatewayController()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.readCliConfigDraft).toHaveBeenCalledTimes(1)
    expect(mocks.readCliConfigDraft).toHaveBeenCalledWith(expect.objectContaining({ gateway }))
  })

  it('keeps the real modelId when a matching gateway raw-file edit round-trips', async () => {
    const { result } = renderGatewayController()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.draft.modelId).toBe('deepseek::deepseek-chat')

    act(() => result.current.onCliConfigFilesChange(gatewayRawFiles))

    // The gateway-addressed connection.model must not be recombined with the
    // synthetic provider id into a corrupt "cherry:api-gateway::…" UniqueModelId.
    expect(result.current.draft.mode).toBe('managed')
    expect(result.current.draft.modelId).toBe('deepseek::deepseek-chat')
  })

  // Reviewer A1: with no model selected yet, a raw edit whose gateway address resolves to an
  // enabled model must become a managed draft carrying that real UniqueModelId — otherwise the
  // submit path drops the edit (no cliConfigModelId → parent returns while the dialog closes).
  it('reverse-resolves a model-less gateway raw edit to the real modelId', async () => {
    const { result } = renderGatewayController({ modelId: null })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => result.current.onCliConfigFilesChange(gatewayRawFiles))

    expect(result.current.draft.mode).toBe('managed')
    expect(result.current.draft.modelId).toBe('deepseek::deepseek-chat')
  })

  // When the raw address can't be resolved to an enabled model, the edit must still be preserved:
  // persist it verbatim as a foreign draft (cliConfigOnly) instead of silently discarding it.
  it('keeps a model-less gateway raw edit as foreign when the model cannot be resolved', async () => {
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue({
      baseUrl: GATEWAY_BASE_URL,
      apiKey: 'cs-sk-gateway',
      model: 'deepseek:ghost-model'
    })
    const { result } = renderGatewayController({ modelId: null })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => result.current.onCliConfigFilesChange(gatewayRawFiles))

    expect(result.current.draft.mode).toBe('foreign')
    expect(result.current.draft.files).toEqual(gatewayRawFiles)
  })

  // A saved detailed config carries no top-level modelId — the role addresses are the only way back
  // to a real model, and they only resolve once the model query has returned.
  const detailedProviderConfig: CliProviderConfig = {
    modelId: null,
    config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek:deepseek-chat' } }
  }

  function renderGatewayLoadController(
    initialProps: { isModelsLoading: boolean; models: Map<UniqueModelId, Model> },
    providerConfig: CliProviderConfig = detailedProviderConfig
  ) {
    return renderHook(
      (props: { isModelsLoading: boolean; models: Map<UniqueModelId, Model> }) =>
        useConfigDraftController({
          cliTool: CodeCli.CLAUDE_CODE,
          provider: gatewayProvider,
          providerConfig,
          isCurrentProvider: true,
          apiKeys: [{ id: 'gateway', key: 'cs-sk-gateway', isEnabled: true }],
          gateway,
          models: props.models,
          isModelsLoading: props.isModelsLoading,
          onSubmit: vi.fn(),
          onClose: vi.fn()
        }),
      { initialProps }
    )
  }

  // Reviewer A7: the gateway synthesizes its apiKeys synchronously, so the initial load fires on the
  // first frame. An in-flight model query yields an empty (but truthy) map, which resolves no role
  // address — the load would latch a managed draft that never ran the foreign check.
  it('does not judge managed/foreign until the gateway model query resolves', async () => {
    const { result } = renderGatewayLoadController({ isModelsLoading: true, models: new Map() })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.readCliConfigFiles).not.toHaveBeenCalled()
    expect(result.current.draft.mode).toBe('managed')
  })

  it('judges a detailed gateway config foreign once the model query resolves', async () => {
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue({
      baseUrl: 'https://api.other-tool.com/v1',
      apiKey: 'sk-foreign',
      model: 'deepseek:deepseek-chat'
    })
    const { result, rerender } = renderGatewayLoadController({ isModelsLoading: true, models: new Map() })

    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.readCliConfigFiles).not.toHaveBeenCalled()

    rerender({ isModelsLoading: false, models: gatewayModels })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.readCliConfigFiles).toHaveBeenCalledTimes(1)
    expect(result.current.draft.mode).toBe('foreign')
  })

  // The match itself reads the model map (to turn a stored id into its "providerId:apiModelId"
  // address), so the load must use the resolved map too — a first-frame snapshot falls back to the
  // raw model id and mislabels a perfectly good config as foreign whenever apiModelId differs.
  it('does not mislabel a common-mode config as foreign when apiModelId differs from the model id', async () => {
    const renamedModels = new Map<UniqueModelId, Model>([
      ['deepseek::deepseek-chat', { apiModelId: 'deepseek-v3' } as Model]
    ])
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue({
      baseUrl: GATEWAY_BASE_URL,
      apiKey: 'cs-sk-gateway',
      model: 'deepseek:deepseek-v3'
    })
    const { result, rerender } = renderGatewayLoadController(
      { isModelsLoading: true, models: new Map() },
      { modelId: 'deepseek::deepseek-chat' }
    )

    await act(async () => {
      await Promise.resolve()
    })

    rerender({ isModelsLoading: false, models: renamedModels })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.draft.mode).toBe('managed')
  })

  // Reviewer A1: the mode flip alone makes the dialog dirty, but common mode has no model to write —
  // saving would clear the stored model and leave the applied CLI file on its old detailed config.
  it('keeps Save disabled when a detailed config flips to common mode with no model', async () => {
    const { result } = renderGatewayLoadController({ isModelsLoading: false, models: gatewayModels })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.claudeModelMode).toBe('detailed')

    act(() => result.current.onClaudeModelModeChange('common'))
    expect(result.current.canSave).toBe(false)

    act(() => result.current.onModelSelect('deepseek::deepseek-chat'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.canSave).toBe(true)
  })

  // The mirror flip has the same failure shape: detailed mode with every role slot empty resolves no
  // model either, so Save must stay disabled rather than being armed and then rejected on click.
  it('keeps Save disabled when a common config flips to detailed mode with no role model', async () => {
    const { result } = renderGatewayLoadController(
      { isModelsLoading: false, models: gatewayModels },
      {
        modelId: 'deepseek::deepseek-chat'
      }
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.claudeModelMode).toBe('common')

    act(() => result.current.onClaudeModelModeChange('detailed'))
    act(() => result.current.onConfigChange({ permissionMode: 'plan' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.canSave).toBe(false)

    act(() => result.current.onConfigChange({ env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek:deepseek-chat' } }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.canSave).toBe(true)
  })

  it('submits a detailed gateway model as its real UniqueModelId without a primary model', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { result } = renderGatewayController(undefined, { onSubmit })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => result.current.onClaudeModelModeChange('detailed'))
    act(() =>
      result.current.onConfigChange({
        env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek:deepseek-chat' }
      })
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      result.current.onSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        cliConfigModelId: 'deepseek::deepseek-chat',
        writePrimaryModel: false
      })
    )
  })
})

describe('useConfigDraftController (submit failure)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCliConfigFiles.mockResolvedValue([])
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue(null)
  })

  async function renderDirtyController(onSubmit: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>) {
    // Not the applied provider: clearing the model is only a scaffold to get a dirty draft, and the
    // applied case legitimately refuses to arm Save without a model (it would strand the CLI files).
    const rendered = renderController([{ id: 'k1', key: 'sk-real', isEnabled: true }], {
      onSubmit,
      onClose,
      isCurrentProvider: false
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // Clearing the model differs from the initial draft → dirty, and skips the
    // async managed-draft rebuild, keeping the submit path synchronous.
    act(() => rendered.result.current.onModelSelect(undefined))
    expect(rendered.result.current.canSave).toBe(true)
    return rendered
  }

  it('keeps the dialog open and toasts when the submit fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('write failed'))
    const onClose = vi.fn()
    const { result } = await renderDirtyController(onSubmit, onClose)

    await act(async () => {
      result.current.onSubmit()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('code.apply_failed')
    expect(result.current.submitting).toBe(false)
  })

  it('closes the dialog when the submit succeeds', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { result } = await renderDirtyController(onSubmit, onClose)

    await act(async () => {
      result.current.onSubmit()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
