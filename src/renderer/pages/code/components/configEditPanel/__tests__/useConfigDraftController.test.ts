import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractConnectionFromCliConfigDraft: vi.fn(),
  readCliConfigFiles: vi.fn()
}))

vi.mock('@renderer/pages/code/cliConfig', async (importOriginal) => {
  // oxlint-disable-next-line consistent-type-imports
  const actual = await importOriginal<typeof import('@renderer/pages/code/cliConfig')>()
  return {
    ...actual,
    extractConnectionFromCliConfigDraft: mocks.extractConnectionFromCliConfigDraft,
    readCliConfigFiles: mocks.readCliConfigFiles,
    readCliConfigDraft: vi.fn().mockResolvedValue([]),
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

function renderController(apiKeys: ApiKeyEntry[] | undefined) {
  return renderHook(
    (props: { apiKeys: ApiKeyEntry[] | undefined }) =>
      useConfigDraftController({
        cliTool: CodeCli.OPENAI_CODEX,
        provider: codexProvider,
        providerConfig: { modelId: 'deepseek::deepseek-chat' },
        isCurrentProvider: true,
        apiKeys: props.apiKeys,
        onSubmit: vi.fn(),
        onClose: vi.fn()
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
