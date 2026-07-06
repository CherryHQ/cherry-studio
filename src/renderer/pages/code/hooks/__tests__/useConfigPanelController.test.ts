import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearCliConfig: vi.fn(),
  writeCliConfigDraft: vi.fn(),
  resolveCliConfigApplyContext: vi.fn(),
  parseConfiguredModelId: vi.fn()
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
vi.mock('../../cliConfig/draft', () => ({ writeCliConfigDraft: mocks.writeCliConfigDraft }))
vi.mock('../../cliConfig/applyContext', () => ({
  parseConfiguredModelId: mocks.parseConfiguredModelId,
  resolveCliConfigApplyContext: mocks.resolveCliConfigApplyContext
}))
vi.mock('../../cliConfig/parser', () => ({ extractConnectionFromCliConfigDraft: vi.fn() }))
vi.mock('../../cliConfig/sanitize', () => ({ sanitizeCliConfigBlob: vi.fn() }))

const { useConfigPanelController } = await import('../useConfigPanelController')

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function baseOptions() {
  return {
    selectedCliTool: CodeCli.CLAUDE_CODE,
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
    window.toast = { error: vi.fn() } as any
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
})
