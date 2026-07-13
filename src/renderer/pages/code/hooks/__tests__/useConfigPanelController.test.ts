import { toast } from '@renderer/services/toast'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearCliConfig: vi.fn(),
  writeCliConfigDraft: vi.fn(),
  writeOwnLoginCliConfigDraft: vi.fn(),
  isOwnLoginConfigurable: vi.fn(),
  resolveCliConfigApplyContext: vi.fn(),
  parseConfiguredModelId: vi.fn(),
  sanitizeCliConfigBlob: vi.fn()
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../cliConfig/clear', () => ({ clearCliConfig: mocks.clearCliConfig }))
vi.mock('../../cliConfig/draft', () => ({
  writeCliConfigDraft: mocks.writeCliConfigDraft,
  writeOwnLoginCliConfigDraft: mocks.writeOwnLoginCliConfigDraft,
  isOwnLoginConfigurable: mocks.isOwnLoginConfigurable
}))
vi.mock('../../cliConfig/applyContext', () => ({
  parseConfiguredModelId: mocks.parseConfiguredModelId,
  resolveCliConfigApplyContext: mocks.resolveCliConfigApplyContext
}))
vi.mock('../../cliConfig/parser', () => ({ extractConnectionFromCliConfigDraft: vi.fn() }))
// `sanitizeCliConfigBlob` now lives in the adapter registry (re-exported via the barrel).
// Keep the real registry so any transitive importer of `adapters` (getAdapter/CLI_CONFIG_ADAPTERS)
// still resolves; override only the sanitizer this test asserts on.
vi.mock('../../cliConfig/adapters', async (importOriginal) => ({
  // oxlint-disable-next-line consistent-type-imports
  ...(await importOriginal<typeof import('../../cliConfig/adapters')>()),
  sanitizeCliConfigBlob: mocks.sanitizeCliConfigBlob
}))

const { useConfigPanelController } = await import('../useConfigPanelController')

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function baseOptions() {
  return {
    selectedCliTool: CodeCli.CLAUDE_CODE,
    toolName: 'Claude Code',
    isToolInstalled: true,
    currentProviderId: 'p1',
    providerConfigs: {},
    upsertProviderConfig: vi.fn().mockResolvedValue('p1'),
    setCurrentProvider: vi.fn().mockResolvedValue(undefined),
    setCurrentCliConfigConnection: vi.fn(),
    makeModelFilter: vi.fn(() => () => true)
  }
}

describe('useConfigPanelController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Only Claude Code's own-login entry is configurable (writes tool params); the rest clear-on-select.
    mocks.isOwnLoginConfigurable.mockImplementation((tool: string) => tool === CodeCli.CLAUDE_CODE)
    // Identity sanitize: keep the blob as-is so assertions can match the input.
    mocks.sanitizeCliConfigBlob.mockImplementation((_tool: string, blob: unknown) => blob)
  })

  describe('onToggleCurrent in-flight guard', () => {
    // Regression: writeCliConfigDraft / clearCliConfig write multiple files sequentially with no
    // cross-file lock, so a rapid second toggle for the same tool must be dropped, not interleaved.
    it('ignores a re-entrant toggle for the same tool while the first is still in flight', async () => {
      let releaseClear: (() => void) | undefined
      mocks.clearCliConfig.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseClear = () => resolve()
          })
      )
      const { result } = renderHook(() => useConfigPanelController(baseOptions()))
      const provider = { id: 'p1' } as Provider // matches currentProviderId → toggling disables it

      act(() => {
        result.current.onToggleCurrent(provider)
      })
      act(() => {
        result.current.onToggleCurrent(provider)
      })

      // The second toggle is blocked while the first clearCliConfig is still pending.
      expect(mocks.clearCliConfig).toHaveBeenCalledTimes(1)

      // Once the first settles, the guard is released and a subsequent toggle runs again.
      await act(async () => {
        releaseClear?.()
        await flushMicrotasks()
      })
      act(() => {
        result.current.onToggleCurrent(provider)
      })
      expect(mocks.clearCliConfig).toHaveBeenCalledTimes(2)
    })

    // Same guard, enable branch: a re-entrant toggle must be dropped while writeCliConfigDraft is
    // pending, so the sequential multi-file write can't be interleaved with a second one.
    it('ignores a re-entrant toggle for the same tool while the enable write is in flight', async () => {
      let releaseWrite: (() => void) | undefined
      mocks.writeCliConfigDraft.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseWrite = () => resolve()
          })
      )
      mocks.resolveCliConfigApplyContext.mockReturnValue({ modelId: 'm1', writePrimaryModel: true })
      // currentProviderId null ≠ provider id → toggling enables it → writeCliConfigDraft
      const { result } = renderHook(() => useConfigPanelController({ ...baseOptions(), currentProviderId: null }))
      const provider = { id: 'p2' } as Provider

      act(() => {
        result.current.onToggleCurrent(provider)
      })
      act(() => {
        result.current.onToggleCurrent(provider)
      })

      expect(mocks.writeCliConfigDraft).toHaveBeenCalledTimes(1)

      await act(async () => {
        releaseWrite?.()
        await flushMicrotasks()
      })
      act(() => {
        result.current.onToggleCurrent(provider)
      })
      expect(mocks.writeCliConfigDraft).toHaveBeenCalledTimes(2)
    })
  })

  describe('install gate', () => {
    beforeEach(() => {
      // clearAllMocks() keeps the never-resolving clearCliConfig impl from the in-flight guard tests.
      mocks.clearCliConfig.mockReset()
      mocks.clearCliConfig.mockResolvedValue(undefined)
    })

    it('blocks enabling a provider and nudges to install when the CLI is not installed', async () => {
      const options = { ...baseOptions(), isToolInstalled: false, currentProviderId: null }
      const { result } = renderHook(() => useConfigPanelController(options))
      const provider = { id: 'p2' } as Provider // not current → enabling

      await act(async () => {
        result.current.onToggleCurrent(provider)
        await flushMicrotasks()
      })

      expect(toast.error).toHaveBeenCalledWith('code.install_tool_first')
      expect(options.setCurrentProvider).not.toHaveBeenCalled()
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
    })

    it('still allows disabling the current provider when the CLI is not installed', async () => {
      const options = { ...baseOptions(), isToolInstalled: false, currentProviderId: 'p1' }
      const { result } = renderHook(() => useConfigPanelController(options))
      const provider = { id: 'p1' } as Provider // current → disabling

      await act(async () => {
        result.current.onToggleCurrent(provider)
        await flushMicrotasks()
      })

      expect(mocks.clearCliConfig).toHaveBeenCalledWith({ cliTool: CodeCli.CLAUDE_CODE })
      expect(options.setCurrentProvider).toHaveBeenCalledWith(null)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('own-login toggle (via onToggleCurrent with the reserved id)', () => {
    const ownLoginProvider = { id: CLI_OWN_LOGIN_PROVIDER_ID } as Provider

    beforeEach(() => {
      // clearAllMocks() keeps prior mockImplementations (e.g. the never-resolving one from the
      // in-flight guard tests); restore resolved apply mocks so the toggle can proceed.
      mocks.clearCliConfig.mockReset()
      mocks.clearCliConfig.mockResolvedValue(undefined)
      mocks.writeOwnLoginCliConfigDraft.mockReset()
      mocks.writeOwnLoginCliConfigDraft.mockResolvedValue(undefined)
    })

    it('selects own-login for a configurable tool: scrubs credentials, then writes the saved tool params', async () => {
      const options = {
        ...baseOptions(),
        providerConfigs: { [CLI_OWN_LOGIN_PROVIDER_ID]: { config: { effortLevel: 'high' } } } as any
      }
      const { result } = renderHook(() => useConfigPanelController(options))

      await act(async () => {
        result.current.onToggleCurrent(ownLoginProvider)
        await flushMicrotasks()
      })

      // Credentials/model (incl. credential-only side files) are scrubbed first, then params applied.
      expect(mocks.clearCliConfig).toHaveBeenCalledWith({ cliTool: CodeCli.CLAUDE_CODE })
      expect(mocks.writeOwnLoginCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        configBlob: { effortLevel: 'high' }
      })
      expect(options.setCurrentProvider).toHaveBeenCalledWith(CLI_OWN_LOGIN_PROVIDER_ID)
      expect(options.setCurrentCliConfigConnection).toHaveBeenCalledWith(null)
      // Own-login never falls through to the provider-injection path.
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
    })

    it('selects own-login for a non-configurable tool: only clears, no tool params', async () => {
      const options = { ...baseOptions(), selectedCliTool: CodeCli.GEMINI_CLI, currentProviderId: 'p1' }
      const { result } = renderHook(() => useConfigPanelController(options))

      await act(async () => {
        result.current.onToggleCurrent(ownLoginProvider)
        await flushMicrotasks()
      })

      expect(mocks.clearCliConfig).toHaveBeenCalledWith({ cliTool: CodeCli.GEMINI_CLI })
      expect(mocks.writeOwnLoginCliConfigDraft).not.toHaveBeenCalled()
      expect(options.setCurrentProvider).toHaveBeenCalledWith(CLI_OWN_LOGIN_PROVIDER_ID)
    })

    it('deselects own-login when it is already current: clears the injected config', async () => {
      const options = { ...baseOptions(), currentProviderId: CLI_OWN_LOGIN_PROVIDER_ID }
      const { result } = renderHook(() => useConfigPanelController(options))

      await act(async () => {
        result.current.onToggleCurrent(ownLoginProvider)
        await flushMicrotasks()
      })

      expect(mocks.clearCliConfig).toHaveBeenCalledWith({ cliTool: CodeCli.CLAUDE_CODE })
      expect(mocks.writeOwnLoginCliConfigDraft).not.toHaveBeenCalled()
      expect(options.setCurrentProvider).toHaveBeenCalledWith(null)
    })

    it('saves own-login config and re-applies when own-login is the active selection', async () => {
      const options = { ...baseOptions(), currentProviderId: CLI_OWN_LOGIN_PROVIDER_ID }
      const { result } = renderHook(() => useConfigPanelController(options))

      // Open the own-login config panel so its onSubmit is exposed.
      act(() => {
        result.current.openConfigurePanel(ownLoginProvider)
      })
      const submit = result.current.ownLoginConfigPanelProps?.onSubmit
      expect(submit).toBeTypeOf('function')

      await act(async () => {
        await submit?.({ config: { effortLevel: 'high' } })
      })

      expect(options.upsertProviderConfig).toHaveBeenCalledWith(CLI_OWN_LOGIN_PROVIDER_ID, {
        modelId: null,
        config: { effortLevel: 'high' }
      })
      expect(mocks.writeOwnLoginCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        configBlob: { effortLevel: 'high' },
        files: undefined
      })
    })

    // Same single-owner failure contract as the provider panel: a failed own-login injection must
    // reject so OwnLoginConfigPanel keeps the dialog (and the user's edits) open instead of closing.
    // Reviewer A3: the preference must NOT be persisted when the disk write fails — otherwise the
    // panel recomputes its baseline from the new prop, `isConfigDirty` collapses to false, and Save
    // is disabled, so the user can't retry the write directly.
    it('propagates an own-login injection failure and leaves the preference unpersisted (retryable)', async () => {
      const options = { ...baseOptions(), currentProviderId: CLI_OWN_LOGIN_PROVIDER_ID }
      mocks.writeOwnLoginCliConfigDraft.mockReset()
      mocks.writeOwnLoginCliConfigDraft.mockRejectedValue(new Error('settings write failed'))
      const { result } = renderHook(() => useConfigPanelController(options))

      act(() => {
        result.current.openConfigurePanel(ownLoginProvider)
      })

      await expect(
        result.current.ownLoginConfigPanelProps!.onSubmit({ config: { effortLevel: 'high' } })
      ).rejects.toThrow('settings write failed')
      // Write is attempted before the preference is persisted, so a failure aborts before upsert.
      expect(options.upsertProviderConfig).not.toHaveBeenCalled()
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
    })

    it('writes hand-edited raw files verbatim when own-login config is saved with raw edits', async () => {
      const options = { ...baseOptions(), currentProviderId: CLI_OWN_LOGIN_PROVIDER_ID }
      const { result } = renderHook(() => useConfigPanelController(options))

      act(() => {
        result.current.openConfigurePanel(ownLoginProvider)
      })
      const rawFiles = [
        { target: 'claude-settings', label: 'settings.json', path: '/tmp/s.json', language: 'json', content: '{}' }
      ] as any

      await act(async () => {
        await result.current.ownLoginConfigPanelProps?.onSubmit({
          config: { effortLevel: 'high' },
          cliConfigFiles: rawFiles
        })
      })

      expect(mocks.writeOwnLoginCliConfigDraft).toHaveBeenCalledWith({
        cliTool: CodeCli.CLAUDE_CODE,
        configBlob: { effortLevel: 'high' },
        files: rawFiles
      })
    })
  })

  // Reviewer A3: the active-provider state must only change after the CLI files were actually
  // rewritten. If the scrub/write fails, leaving `currentProvider` flipped would show the UI as
  // switched/disabled while the CLI still holds the previous managed credentials.
  describe('clear/write failure keeps the active-provider state (A3)', () => {
    const ownLoginProvider = { id: CLI_OWN_LOGIN_PROVIDER_ID } as Provider

    it('does not clear the active provider when the disable scrub fails', async () => {
      const options = { ...baseOptions(), currentProviderId: 'p1' }
      mocks.clearCliConfig.mockReset()
      mocks.clearCliConfig.mockRejectedValue(new Error('scrub failed'))
      const { result } = renderHook(() => useConfigPanelController(options))
      const provider = { id: 'p1' } as Provider // current → disabling

      await act(async () => {
        result.current.onToggleCurrent(provider)
        await flushMicrotasks()
      })

      expect(mocks.clearCliConfig).toHaveBeenCalled()
      expect(options.setCurrentProvider).not.toHaveBeenCalled()
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('code.apply_failed')
    })

    it('does not switch to own login when the scrub fails', async () => {
      const options = { ...baseOptions() } // currentProviderId 'p1' → toggling selects own login
      mocks.clearCliConfig.mockReset()
      mocks.clearCliConfig.mockRejectedValue(new Error('scrub failed'))
      const { result } = renderHook(() => useConfigPanelController(options))

      await act(async () => {
        result.current.onToggleCurrent(ownLoginProvider)
        await flushMicrotasks()
      })

      expect(mocks.clearCliConfig).toHaveBeenCalled()
      expect(mocks.writeOwnLoginCliConfigDraft).not.toHaveBeenCalled()
      expect(options.setCurrentProvider).not.toHaveBeenCalled()
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('code.apply_failed')
    })

    // The multi-file case the reviewer called out (e.g. Gemini): scrub succeeds but the tool-params
    // write fails — the selection must not flip while the config is half-written.
    it('does not switch to own login when the tool-params write fails after a successful scrub', async () => {
      const options = { ...baseOptions() }
      mocks.clearCliConfig.mockReset()
      mocks.clearCliConfig.mockResolvedValue(undefined)
      mocks.writeOwnLoginCliConfigDraft.mockReset()
      mocks.writeOwnLoginCliConfigDraft.mockRejectedValue(new Error('settings write failed'))
      const { result } = renderHook(() => useConfigPanelController(options))

      await act(async () => {
        result.current.onToggleCurrent(ownLoginProvider)
        await flushMicrotasks()
      })

      expect(mocks.writeOwnLoginCliConfigDraft).toHaveBeenCalled()
      expect(options.setCurrentProvider).not.toHaveBeenCalled()
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('code.apply_failed')
    })

    // Reviewer: a failed config injection on panel save must reject (not be swallowed) so the
    // submitting dialog treats the save as failed, keeps the user's draft, and stays open.
    it('propagates a config-write failure on panel save to the submitting dialog', async () => {
      const options = { ...baseOptions(), currentProviderId: 'p1' } // editing the active provider
      mocks.resolveCliConfigApplyContext.mockReturnValue({ modelId: 'm1', writePrimaryModel: true })
      mocks.writeCliConfigDraft.mockReset()
      mocks.writeCliConfigDraft.mockRejectedValue(new Error('config write failed'))
      const { result } = renderHook(() => useConfigPanelController(options))

      act(() => {
        result.current.openConfigurePanel({ id: 'p1' } as Provider)
      })
      const submit = result.current.configPanelProps?.onSubmit
      expect(submit).toBeTypeOf('function')

      await expect(submit!({ modelId: 'anthropic::claude-sonnet-4-5' as any, config: {} })).rejects.toThrow(
        'config write failed'
      )
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
    })

    it('propagates a gateway ensureReady failure on panel save to the submitting dialog', async () => {
      const ensureReady = vi.fn().mockRejectedValue(new Error('API gateway failed to start'))
      const options = {
        ...baseOptions(),
        currentProviderId: CLI_API_GATEWAY_PROVIDER_ID, // editing the active gateway provider
        apiGatewayProvider: {
          provider: { id: CLI_API_GATEWAY_PROVIDER_ID } as Provider,
          apiKey: 'cs-sk-old',
          ensureReady
        }
      }
      mocks.resolveCliConfigApplyContext.mockReturnValue({ modelId: 'm1', writePrimaryModel: true })
      const { result } = renderHook(() => useConfigPanelController(options))

      act(() => {
        result.current.openConfigurePanel({ id: CLI_API_GATEWAY_PROVIDER_ID } as Provider)
      })

      await expect(
        result.current.configPanelProps!.onSubmit({ modelId: 'deepseek::deepseek-chat' as any, config: {} })
      ).rejects.toThrow('API gateway failed to start')
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(options.setCurrentCliConfigConnection).not.toHaveBeenCalled()
    })

    // Reviewer A3-1: enabling the gateway must not write the CLI config or mark it current when the
    // gateway fails to start — otherwise the UI shows the gateway active with nothing listening on the
    // port. `ensureReady` throws on a failed start; the write and selection flip must both be skipped.
    it('does not enable the gateway when ensureReady (start) fails', async () => {
      const ensureReady = vi.fn().mockRejectedValue(new Error('API gateway failed to start'))
      const options = {
        ...baseOptions(),
        currentProviderId: null, // gateway not current → toggling enables it
        apiGatewayProvider: {
          provider: { id: CLI_API_GATEWAY_PROVIDER_ID } as Provider,
          apiKey: 'cs-sk-old',
          ensureReady
        }
      }
      mocks.resolveCliConfigApplyContext.mockReturnValue({ modelId: 'm1', writePrimaryModel: true })
      const { result } = renderHook(() => useConfigPanelController(options))
      const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID } as Provider

      await act(async () => {
        result.current.onToggleCurrent(gatewayProvider)
        await flushMicrotasks()
      })

      expect(ensureReady).toHaveBeenCalled()
      // Never wrote a config against a dead port, never flipped the active selection.
      expect(mocks.writeCliConfigDraft).not.toHaveBeenCalled()
      expect(options.setCurrentProvider).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('code.apply_failed')
    })
  })
})
