import { codeCLI, terminalApps } from '@shared/config/constant'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSetOverrides = vi.fn().mockResolvedValue(undefined)
let mockOverrides: Record<string, any> = {}

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: vi.fn(() => [mockOverrides, mockSetOverrides])
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

describe('useCodeTools', () => {
  beforeEach(() => {
    mockOverrides = {}
    mockSetOverrides.mockClear()
    vi.resetModules()
  })

  it('should return default selectedCliTool when no tool is enabled', async () => {
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedCliTool).toBe(codeCLI.qwenCode)
  })

  it('should return the enabled tool as selectedCliTool', async () => {
    mockOverrides = { 'claude-code': { enabled: true } }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedCliTool).toBe(codeCLI.claudeCode)
  })

  it('should return per-tool modelId', async () => {
    mockOverrides = { 'claude-code': { enabled: true, modelId: 'anthropic::claude-3-opus' } }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedModel).toBe('anthropic::claude-3-opus')
  })

  it('should return default terminal when none set', async () => {
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedTerminal).toBe(terminalApps.systemDefault)
  })

  it('should update overrides when setCliTool is called', async () => {
    mockOverrides = { 'qwen-code': { enabled: true } }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())

    await act(async () => {
      await result.current.setCliTool(codeCLI.claudeCode)
    })

    expect(mockSetOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        'qwen-code': expect.objectContaining({ enabled: false }),
        'claude-code': expect.objectContaining({ enabled: true })
      })
    )
  })

  it('should update modelId for current tool when setModel is called', async () => {
    mockOverrides = { 'qwen-code': { enabled: true } }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())

    await act(async () => {
      await result.current.setModel('openai::gpt-4')
    })

    expect(mockSetOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        'qwen-code': expect.objectContaining({ modelId: 'openai::gpt-4' })
      })
    )
  })

  it('canLaunch should be true when tool, directory, and model are set', async () => {
    mockOverrides = {
      'qwen-code': { enabled: true, modelId: 'openai::gpt-4', currentDirectory: '/tmp/project' }
    }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.canLaunch).toBe(true)
  })

  it('canLaunch should be true for github-copilot-cli without model', async () => {
    mockOverrides = {
      'github-copilot-cli': { enabled: true, currentDirectory: '/tmp/project' }
    }
    const { useCodeTools } = await import('../useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.canLaunch).toBe(true)
  })
})
