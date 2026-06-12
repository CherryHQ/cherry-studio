import { codeCLI, terminalApps } from '@shared/config/constant'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodeCli } from '../useCodeCli'

/**
 * Helper: set up the unified mock to return a specific overrides value
 * and capture calls to the setter.
 */
function setupOverridesMock(overrides: Record<string, any>) {
  const mockSetOverrides = vi.fn().mockResolvedValue(undefined)
  mockUsePreference.mockImplementation((key: string) => {
    if (key === 'feature.code_cli.overrides') {
      return [overrides, mockSetOverrides]
    }
    return [null, vi.fn().mockResolvedValue(undefined)]
  })
  return mockSetOverrides
}

describe('useCodeCli', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  describe('selectedCliTool', () => {
    it('should return default tool when no tool is enabled', () => {
      setupOverridesMock({})
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.selectedCliTool).toBe(codeCLI.qwenCode)
    })

    it('should return the enabled tool', () => {
      setupOverridesMock({ 'claude-code': { enabled: true } })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.selectedCliTool).toBe(codeCLI.claudeCode)
    })
  })

  describe('currentConfig', () => {
    it('should return per-tool modelId', () => {
      setupOverridesMock({ 'claude-code': { enabled: true, modelId: 'anthropic::claude-3-opus' } })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.selectedModel).toBe('anthropic::claude-3-opus')
    })

    it('should return default terminal when none set', () => {
      setupOverridesMock({})
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.selectedTerminal).toBe(terminalApps.systemDefault)
    })
  })

  describe('setCliTool', () => {
    it('should disable current tool and enable new tool', async () => {
      const mockSetter = setupOverridesMock({ 'qwen-code': { enabled: true } })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCliTool(codeCLI.claudeCode)
      })

      expect(mockSetter).toHaveBeenCalledWith(
        expect.objectContaining({
          'qwen-code': expect.objectContaining({ enabled: false }),
          'claude-code': expect.objectContaining({ enabled: true })
        })
      )
    })
  })

  describe('setModel', () => {
    it('should update modelId for current tool', async () => {
      const mockSetter = setupOverridesMock({ 'qwen-code': { enabled: true } })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setModel('openai::gpt-4')
      })

      expect(mockSetter).toHaveBeenCalledWith(
        expect.objectContaining({
          'qwen-code': expect.objectContaining({ modelId: 'openai::gpt-4' })
        })
      )
    })
  })

  describe('canLaunch', () => {
    it('should be true when tool, directory, and model are set', () => {
      setupOverridesMock({
        'qwen-code': { enabled: true, modelId: 'openai::gpt-4', currentDirectory: '/tmp/project' }
      })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(true)
    })

    it('should be true for github-copilot-cli without model', () => {
      setupOverridesMock({
        'github-copilot-cli': { enabled: true, currentDirectory: '/tmp/project' }
      })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(true)
    })

    it('should be false when no directory is set', () => {
      setupOverridesMock({
        'qwen-code': { enabled: true, modelId: 'openai::gpt-4' }
      })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(false)
    })

    it('should be false when no model is set for non-copilot tool', () => {
      setupOverridesMock({
        'qwen-code': { enabled: true, currentDirectory: '/tmp/project' }
      })
      const { result } = renderHook(() => useCodeCli())
      expect(result.current.canLaunch).toBe(false)
    })
  })

  describe('setCurrentDir', () => {
    it('should set directory and add to directories list', async () => {
      const mockSetter = setupOverridesMock({ 'qwen-code': { enabled: true } })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentDir('/new/project')
      })

      expect(mockSetter).toHaveBeenCalledWith(
        expect.objectContaining({
          'qwen-code': expect.objectContaining({
            currentDirectory: '/new/project',
            directories: ['/new/project']
          })
        })
      )
    })

    it('should move existing directory to front of list', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, directories: ['/a', '/b', '/c'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentDir('/c')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].directories).toEqual(['/c', '/a', '/b'])
    })

    it('should limit directories list to 10 entries', async () => {
      const dirs = Array.from({ length: 10 }, (_, i) => `/dir${i}`)
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, directories: dirs }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentDir('/new-dir')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].directories).toHaveLength(10)
      expect(calledValue['qwen-code'].directories[0]).toBe('/new-dir')
    })

    it('should not modify directories when directory is empty', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, directories: ['/a', '/b'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.setCurrentDir('')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].directories).toEqual(['/a', '/b'])
      expect(calledValue['qwen-code'].currentDirectory).toBe('')
    })
  })

  describe('removeDir', () => {
    it('should remove directory from the list', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, directories: ['/a', '/b', '/c'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.removeDir('/b')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].directories).toEqual(['/a', '/c'])
    })

    it('should reset currentDirectory when removing the current directory', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, currentDirectory: '/a', directories: ['/a', '/b'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.removeDir('/a')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].currentDirectory).toBe('')
      expect(calledValue['qwen-code'].directories).toEqual(['/b'])
    })

    it('should not reset currentDirectory when removing a different directory', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, currentDirectory: '/a', directories: ['/a', '/b'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.removeDir('/b')
      })

      const calledValue = mockSetter.mock.calls[0][0]
      expect(calledValue['qwen-code'].currentDirectory).toBe('/a')
      expect(calledValue['qwen-code'].directories).toEqual(['/a'])
    })
  })

  describe('resetSettings', () => {
    it('should reset overrides to empty object', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, modelId: 'some-model' }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.resetSettings()
      })

      expect(mockSetter).toHaveBeenCalledWith({})
    })
  })

  describe('clearDirs', () => {
    it('should clear directories and currentDirectory', async () => {
      const mockSetter = setupOverridesMock({
        'qwen-code': { enabled: true, currentDirectory: '/a', directories: ['/a', '/b'] }
      })
      const { result } = renderHook(() => useCodeCli())

      await act(async () => {
        await result.current.clearDirs()
      })

      expect(mockSetter).toHaveBeenCalledWith(
        expect.objectContaining({
          'qwen-code': expect.objectContaining({
            directories: [],
            currentDirectory: ''
          })
        })
      )
    })
  })
})
