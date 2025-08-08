import { useWrapTool } from '@renderer/components/CodeToolbar/hooks/useWrapTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    wrap: {
      id: 'wrap',
      type: 'quick',
      order: 13
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS,
  useToolManager: mocks.useToolManager
}))

// Mock useToolManager
const mockRegisterTool = vi.fn()
const mockRemoveTool = vi.fn()
mocks.useToolManager.mockImplementation(() => ({
  registerTool: mockRegisterTool,
  removeTool: mockRemoveTool
}))

vi.mock('lucide-react', () => ({
  Text: () => <div data-testid="text-icon" />,
  WrapText: () => <div data-testid="wrap-text-icon" />
}))

describe('useWrapTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useWrapTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      unwrapped: false,
      wrappable: true,
      toggle: vi.fn(),
      setTools: vi.fn()
    }

    return { ...defaultProps, ...overrides }
  }

  // Helper function for tool registration assertions
  const expectToolRegistration = (times: number, toolConfig?: object) => {
    expect(mockRegisterTool).toHaveBeenCalledTimes(times)
    if (times > 0 && toolConfig) {
      expect(mockRegisterTool).toHaveBeenCalledWith(expect.objectContaining(toolConfig))
    }
  }

  describe('tool registration', () => {
    it('should register wrap tool when enabled', () => {
      const props = createMockProps({ enabled: true })
      renderHook(() => useWrapTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expectToolRegistration(1, {
        id: 'wrap',
        type: 'quick',
        order: 13,
        tooltip: 'code_block.wrap.off',
        onClick: expect.any(Function),
        visible: expect.any(Function)
      })
    })

    it('should not register tool when disabled', () => {
      const props = createMockProps({ enabled: false })
      renderHook(() => useWrapTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should re-register tool when unwrapped changes', () => {
      const props = createMockProps({ unwrapped: false })
      const { rerender } = renderHook((hookProps) => useWrapTool(hookProps), {
        initialProps: props
      })

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)
      const firstCall = mockRegisterTool.mock.calls[0][0]
      expect(firstCall.tooltip).toBe('code_block.wrap.off')

      // Change unwrapped to true and rerender
      const newProps = { ...props, unwrapped: true }
      rerender(newProps)

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)
      const secondCall = mockRegisterTool.mock.calls[1][0]
      expect(secondCall.tooltip).toBe('code_block.wrap.on')
    })
  })

  describe('visibility behavior', () => {
    it('should be visible when wrappable is true', () => {
      const props = createMockProps({ wrappable: true })
      renderHook(() => useWrapTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(true)
    })

    it('should not be visible when wrappable is false', () => {
      const props = createMockProps({ wrappable: false })
      renderHook(() => useWrapTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(false)
    })

    it('should not be visible when wrappable is undefined', () => {
      const props = createMockProps({ wrappable: undefined })
      renderHook(() => useWrapTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(false)
    })
  })

  describe('toggle functionality', () => {
    it('should execute toggle function when tool is clicked', () => {
      const mockToggle = vi.fn()
      const props = createMockProps({ toggle: mockToggle })
      renderHook(() => useWrapTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockToggle).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useWrapTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('wrap')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useWrapTool(props))
      }).not.toThrow()

      // Should still call useToolManager (but won't actually register)
      expect(mocks.useToolManager).toHaveBeenCalledWith(undefined)
    })

    it('should not break when toggle is undefined', () => {
      const props = createMockProps({ toggle: undefined })
      renderHook(() => useWrapTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()
    })
  })
})
