import { useExpandTool } from '@renderer/components/CodeToolbar/hooks/useExpandTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    expand: {
      id: 'expand',
      type: 'quick',
      order: 12
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
  ChevronsDownUp: () => <div data-testid="chevrons-down-up" />,
  ChevronsUpDown: () => <div data-testid="chevrons-up-down" />
}))

describe('useExpandTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useExpandTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      expanded: false,
      expandable: true,
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
    it('should register expand tool when enabled', () => {
      const props = createMockProps({ enabled: true })
      renderHook(() => useExpandTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expectToolRegistration(1, {
        id: 'expand',
        type: 'quick',
        order: 12,
        tooltip: 'code_block.expand',
        onClick: expect.any(Function),
        visible: expect.any(Function)
      })
    })

    it('should not register tool when disabled', () => {
      const props = createMockProps({ enabled: false })
      renderHook(() => useExpandTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should re-register tool when expanded changes', () => {
      const props = createMockProps({ expanded: false })
      const { rerender } = renderHook((hookProps) => useExpandTool(hookProps), {
        initialProps: props
      })

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)
      const firstCall = mockRegisterTool.mock.calls[0][0]
      expect(firstCall.tooltip).toBe('code_block.expand')

      // Change expanded to true and rerender
      const newProps = { ...props, expanded: true }
      rerender(newProps)

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)
      const secondCall = mockRegisterTool.mock.calls[1][0]
      expect(secondCall.tooltip).toBe('code_block.collapse')
    })
  })

  describe('visibility behavior', () => {
    it('should be visible when expandable is true', () => {
      const props = createMockProps({ expandable: true })
      renderHook(() => useExpandTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(true)
    })

    it('should not be visible when expandable is false', () => {
      const props = createMockProps({ expandable: false })
      renderHook(() => useExpandTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(false)
    })

    it('should not be visible when expandable is undefined', () => {
      const props = createMockProps({ expandable: undefined })
      renderHook(() => useExpandTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool.visible()).toBe(false)
    })
  })

  describe('toggle functionality', () => {
    it('should execute toggle function when tool is clicked', () => {
      const mockToggle = vi.fn()
      const props = createMockProps({ toggle: mockToggle })
      renderHook(() => useExpandTool(props))

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
      const { unmount } = renderHook(() => useExpandTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('expand')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useExpandTool(props))
      }).not.toThrow()

      // Should still call useToolManager (but won't actually register)
      expect(mocks.useToolManager).toHaveBeenCalledWith(undefined)
    })

    it('should not break when toggle is undefined', () => {
      const props = createMockProps({ toggle: undefined })
      renderHook(() => useExpandTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()
    })
  })
})
