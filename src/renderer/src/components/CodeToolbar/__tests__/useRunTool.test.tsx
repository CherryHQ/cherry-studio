import { useRunTool } from '@renderer/components/CodeToolbar/hooks/useRunTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    run: {
      id: 'run',
      type: 'quick',
      order: 11
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('lucide-react', () => ({
  CirclePlay: () => <div>CirclePlay</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div>Loading</div>
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS,
  useToolManager: mocks.useToolManager
}))

const mockRegisterTool = vi.fn()
const mockRemoveTool = vi.fn()
mocks.useToolManager.mockImplementation(() => ({
  registerTool: mockRegisterTool,
  removeTool: mockRemoveTool
}))

describe('useRunTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockProps = (overrides: Partial<Parameters<typeof useRunTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      isRunning: false,
      onRun: vi.fn(),
      setTools: vi.fn()
    }

    return { ...defaultProps, ...overrides }
  }

  const expectToolRegistration = (times: number, toolConfig?: object) => {
    expect(mockRegisterTool).toHaveBeenCalledTimes(times)
    if (times > 0 && toolConfig) {
      expect(mockRegisterTool).toHaveBeenCalledWith(expect.objectContaining(toolConfig))
    }
  }

  describe('tool registration', () => {
    it('should not register tool when disabled', () => {
      const props = createMockProps({ enabled: false })
      renderHook(() => useRunTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should register run tool when enabled', () => {
      const props = createMockProps({ enabled: true })
      renderHook(() => useRunTool(props))

      expectToolRegistration(1, {
        id: 'run',
        type: 'quick',
        order: 11,
        tooltip: 'code_block.run'
      })
    })

    it('should re-register tool when isRunning changes', () => {
      const props = createMockProps({ isRunning: false })
      const { rerender } = renderHook((hookProps) => useRunTool(hookProps), {
        initialProps: props
      })

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)

      const newProps = { ...props, isRunning: true }
      rerender(newProps)

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)
    })
  })

  describe('run functionality', () => {
    it('should execute onRun when tool is clicked and not running', () => {
      const mockOnRun = vi.fn()
      const props = createMockProps({ onRun: mockOnRun, isRunning: false })
      renderHook(() => useRunTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnRun).toHaveBeenCalledTimes(1)
    })

    it('should not execute onRun when tool is clicked and already running', () => {
      const mockOnRun = vi.fn()
      const props = createMockProps({ onRun: mockOnRun, isRunning: true })
      renderHook(() => useRunTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnRun).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useRunTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('run')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useRunTool(props))
      }).not.toThrow()
    })

    it('should not break when onRun is undefined', () => {
      const props = createMockProps({ onRun: undefined })
      renderHook(() => useRunTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()
    })
  })
})
