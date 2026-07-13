import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
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
  handlers: { onSubmit?: ReturnType<typeof vi.fn>; onClose?: ReturnType<typeof vi.fn> } = {}
) {
  return renderHook(
    (props: { apiKeys: ApiKeyEntry[] | undefined }) =>
      useConfigDraftController({
        cliTool: CodeCli.OPENAI_CODEX,
        provider: codexProvider,
        providerConfig: { modelId: 'deepseek::deepseek-chat' },
        isCurrentProvider: true,
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

  function renderGatewayController() {
    return renderHook(() =>
      useConfigDraftController({
        cliTool: CodeCli.CLAUDE_CODE,
        provider: gatewayProvider,
        providerConfig: { modelId: 'deepseek::deepseek-chat' },
        isCurrentProvider: true,
        apiKeys: [{ id: 'gateway', key: 'cs-sk-gateway', isEnabled: true }],
        gateway,
        models: gatewayModels,
        onSubmit: vi.fn(),
        onClose: vi.fn()
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
})

describe('useConfigDraftController (submit failure)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCliConfigFiles.mockResolvedValue([])
    mocks.extractConnectionFromCliConfigDraft.mockReturnValue(null)
  })

  async function renderDirtyController(onSubmit: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>) {
    const rendered = renderController([{ id: 'k1', key: 'sk-real', isEnabled: true }], { onSubmit, onClose })
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
