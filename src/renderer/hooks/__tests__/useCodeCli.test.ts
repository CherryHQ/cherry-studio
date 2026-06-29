import type { CliProviderConfig, CodeCliConfigs } from '@shared/data/preference/preferenceTypes'
import { CodeCli } from '@shared/types/codeCli'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodeCli } from '../useCodeCli'

/** Set up the preference mock for `feature.code_cli.configs` and capture setter calls. */
function setupConfigsMock(configs: CodeCliConfigs) {
  const mockSetConfigs = vi.fn().mockResolvedValue(undefined)
  mockUsePreference.mockImplementation((key: string) => {
    if (key === 'feature.code_cli.configs') {
      return [configs, mockSetConfigs]
    }
    return [{} as CodeCliConfigs, vi.fn().mockResolvedValue(undefined)]
  })
  return mockSetConfigs
}

/** Set updater-style setter that receives a function (mirrors real usePreference updater). */
function setupUpdaterMock(configs: CodeCliConfigs) {
  let current = configs
  const mockSetConfigs = vi.fn((newValue: CodeCliConfigs) => {
    current = newValue
    return Promise.resolve()
  })
  mockUsePreference.mockImplementation((key: string) => {
    if (key === 'feature.code_cli.configs') {
      return [current, mockSetConfigs]
    }
    return [{} as CodeCliConfigs, vi.fn().mockResolvedValue(undefined)]
  })
  return mockSetConfigs
}

const cfg = (overrides: Partial<CliProviderConfig> = {}): CliProviderConfig => ({
  modelId: overrides.modelId ?? 'anthropic::claude-4',
  ...(overrides.config ? { config: overrides.config } : {}),
  ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {})
})

const state = (providers: Record<string, CliProviderConfig>, current: string | null) => ({
  providers,
  current
})

describe('useCodeCli', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  describe('selectedCliTool', () => {
    it('should default to claude-code', () => {
      setupConfigsMock({} as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.selectedCliTool).toBe(CodeCli.CLAUDE_CODE)
    })

    it('selectTool should switch the selected tool (navigation state)', () => {
      setupConfigsMock({
        'openai-codex': state({ anthropic: cfg() }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      act(() => {
        result.current.selectTool(CodeCli.OPENAI_CODEX)
      })
      expect(result.current.selectedCliTool).toBe(CodeCli.OPENAI_CODEX)
    })
  })

  describe('currentProviderId / currentProviderConfig', () => {
    it('should expose the current provider id and its config', () => {
      setupConfigsMock({
        'claude-code': state({ anthropic: cfg() }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.currentProviderId).toBe('anthropic')
      expect(result.current.currentProviderConfig?.modelId).toBe('anthropic::claude-4')
    })

    it('should return null currentProviderConfig when no provider is active', () => {
      setupConfigsMock({
        'claude-code': state({ anthropic: cfg() }, null)
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.currentProviderId).toBeNull()
      expect(result.current.currentProviderConfig).toBeNull()
    })
  })

  describe('reorderProviders', () => {
    it('should write the ordered provider ids to the tool state', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg(), openrouter: cfg({ modelId: 'openrouter::x' }) }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.reorderProviders(['openrouter', 'anthropic'])
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].providerOrder).toEqual(['openrouter', 'anthropic'])
    })
  })

  describe('upsertProviderConfig', () => {
    it('should create a new provider config keyed by providerId', async () => {
      const mockSetter = setupUpdaterMock({} as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      let returnedId = ''
      await act(async () => {
        returnedId = await result.current.upsertProviderConfig('openrouter', {
          modelId: 'openrouter::claude-4'
        })
      })

      expect(returnedId).toBe('openrouter')
      expect(mockSetter).toHaveBeenCalled()
      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].providers['openrouter']).toBeDefined()
      expect(lastWrite['claude-code'].providers['openrouter'].modelId).toBe('openrouter::claude-4')
    })

    it('should preserve existing config when updating only modelId', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg({ config: { foo: 1 } }) }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.upsertProviderConfig('anthropic', {
          modelId: 'anthropic::claude-5'
        })
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      const updated = lastWrite['claude-code'].providers['anthropic']
      expect(updated.modelId).toBe('anthropic::claude-5')
      expect(updated.config).toEqual({ foo: 1 })
    })
  })

  describe('upsertProviderConfig + setCurrentProvider (sequential write)', () => {
    // Regression: enabling a provider upserts its config then sets current
    // back-to-back. usePreference's setter takes a plain value, so the second
    // write used to read a stale snapshot and wipe the just-written provider.
    it('preserves the upserted provider when selecting it immediately after', async () => {
      const mockSetter = setupUpdaterMock({} as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.upsertProviderConfig('anthropic', {
          modelId: 'anthropic::claude-4'
        })
        await result.current.setCurrentProvider('anthropic')
      })

      expect(mockSetter).toHaveBeenCalledTimes(2)
      const lastWrite = mockSetter.mock.calls[1][0] as CodeCliConfigs
      const toolState = lastWrite[CodeCli.CLAUDE_CODE]
      expect(toolState.providers['anthropic']).toBeDefined()
      expect(toolState.current).toBe('anthropic')
    })
  })

  describe('deleteProviderConfig', () => {
    it('should remove the provider config and clear current if it was active', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg() }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.deleteProviderConfig('anthropic')
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].providers['anthropic']).toBeUndefined()
      expect(lastWrite['claude-code'].current).toBeNull()
    })

    it('should keep current when deleting an inactive provider', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg(), openrouter: cfg({ modelId: 'openrouter::x' }) }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.deleteProviderConfig('openrouter')
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].current).toBe('anthropic')
    })
  })

  describe('setCurrentProvider', () => {
    it('should set the tool current pointer (single-select)', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg(), openrouter: cfg({ modelId: 'openrouter::x' }) }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentProvider('openrouter')
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].current).toBe('openrouter')
    })

    it('should support disabling via null', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg() }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentProvider(null)
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].current).toBeNull()
    })
  })

  describe('setDirectory', () => {
    it('should set the tool-level directory and prepend to the MRU list', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ anthropic: cfg() }, 'anthropic')
      } as unknown as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setDirectory('/new/project')
      })

      const lastWrite = mockSetter.mock.calls.at(-1)?.[0] as CodeCliConfigs
      expect(lastWrite['claude-code'].directory).toBe('/new/project')
      expect(lastWrite['claude-code'].directories).toContain('/new/project')
    })
  })
})
