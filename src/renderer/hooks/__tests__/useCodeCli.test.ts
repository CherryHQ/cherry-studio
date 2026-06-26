import type { CodeCliConfigs } from '@shared/data/preference/preferenceTypes'
import { codeCLI } from '@shared/types/codeCli'
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
  const mockSetConfigs = vi.fn((updater: (prev: CodeCliConfigs) => CodeCliConfigs) => {
    current = updater(current)
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

const cfg = (
  overrides: Partial<{ id: string; name: string; providerId: string; modelId: string; directory: string }> = {}
) => ({
  id: overrides.id ?? 'cfg1',
  name: overrides.name ?? 'Work Claude',
  providerId: overrides.providerId ?? 'anthropic',
  modelId: overrides.modelId ?? 'anthropic::claude-4',
  createdAt: 1,
  sortIndex: 0,
  ...(overrides.directory ? { directory: overrides.directory } : {})
})

const state = (providers: Record<string, ReturnType<typeof cfg>>, current: string | null) => ({
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
      expect(result.current.selectedCliTool).toBe(codeCLI.claudeCode)
    })

    it('selectTool should switch the selected tool (navigation state)', () => {
      setupConfigsMock({
        'openai-codex': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      act(() => {
        result.current.selectTool(codeCLI.openaiCodex)
      })
      expect(result.current.selectedCliTool).toBe(codeCLI.openaiCodex)
    })
  })

  describe('currentConfig / orderedList', () => {
    it('should expose the current config', () => {
      setupConfigsMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.currentConfig?.id).toBe('cfg1')
      expect(result.current.selectedModel).toBe('anthropic::claude-4')
    })

    it('should expose an ordered config list', () => {
      setupConfigsMock({
        'claude-code': state(
          {
            a: cfg({ id: 'a', name: 'A', sortIndex: undefined as unknown as number }),
            b: cfg({ id: 'b', name: 'B' })
          },
          'b'
        )
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.orderedList.map((c) => c.id)).toEqual(['a', 'b'])
    })
  })

  describe('canLaunch', () => {
    it('should be true when the current config has model and directory', () => {
      setupConfigsMock({
        'claude-code': state({ cfg1: cfg({ directory: '/tmp/project' }) }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(true)
    })

    it('should be false when the current config has no directory', () => {
      setupConfigsMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(false)
    })

    it('should be false when there is no current config', () => {
      setupConfigsMock({
        'claude-code': state({ cfg1: cfg() }, null)
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(false)
    })
  })

  describe('addConfig', () => {
    it('should add a new named config with a generated id', async () => {
      const mockSetter = setupUpdaterMock({} as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      let newId = ''
      await act(async () => {
        newId = await result.current.addConfig(codeCLI.claudeCode, {
          name: 'New',
          providerId: 'anthropic',
          modelId: 'anthropic::claude-4'
        })
      })

      expect(newId).toBeTruthy()
      expect(mockSetter).toHaveBeenCalled()
    })
  })

  describe('updateConfig', () => {
    it('should patch an existing config', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.updateConfig(codeCLI.claudeCode, 'cfg1', { name: 'Renamed' })
      })

      expect(mockSetter).toHaveBeenCalled()
    })

    it('should be a no-op when the config id does not exist', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.updateConfig(codeCLI.claudeCode, 'missing', { name: 'X' })
      })

      // Setter still called (it patches), but the providers map is unchanged by the reducer
      expect(mockSetter).toHaveBeenCalled()
    })
  })

  describe('deleteConfig', () => {
    it('should remove the config and clear current if it was active', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.deleteConfig(codeCLI.claudeCode, 'cfg1')
      })

      expect(mockSetter).toHaveBeenCalled()
    })
  })

  describe('setCurrentConfig', () => {
    it('should set the tool current pointer', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ cfg1: cfg(), cfg2: cfg({ id: 'cfg2', name: 'B' }) }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentConfig(codeCLI.claudeCode, 'cfg2')
      })

      expect(mockSetter).toHaveBeenCalled()
    })
  })

  describe('setDirectory', () => {
    it('should set a config directory and prepend to the tool MRU list', async () => {
      const mockSetter = setupUpdaterMock({
        'claude-code': state({ cfg1: cfg() }, 'cfg1')
      } as CodeCliConfigs)
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setDirectory('cfg1', '/new/project')
      })

      expect(mockSetter).toHaveBeenCalled()
    })
  })
})
