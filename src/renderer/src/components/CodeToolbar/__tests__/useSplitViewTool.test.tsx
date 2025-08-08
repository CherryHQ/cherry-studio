import { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useSplitViewTool } from '@renderer/components/CodeToolbar/hooks/useSplitViewTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    'split-view': {
      id: 'split-view',
      type: 'quick',
      order: 10
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

describe('useSplitViewTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useSplitViewTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      viewMode: 'special' as ViewMode,
      onToggleSplitView: vi.fn(),
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
    it('should not register tool when disabled', () => {
      const props = createMockProps({ enabled: false })
      renderHook(() => useSplitViewTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should register split view tool when enabled', () => {
      const props = createMockProps({ enabled: true })
      renderHook(() => useSplitViewTool(props))

      expectToolRegistration(1, {
        id: 'split-view',
        type: 'quick',
        order: 10,
        tooltip: 'code_block.split.label',
        onClick: expect.any(Function),
        icon: expect.any(Object)
      })
    })

    it('should show different tooltip when in split mode', () => {
      const props = createMockProps({ viewMode: 'split' })
      renderHook(() => useSplitViewTool(props))

      expectToolRegistration(1, {
        tooltip: 'code_block.split.restore'
      })
    })

    it('should show different tooltip when not in split mode', () => {
      const props = createMockProps({ viewMode: 'special' })
      renderHook(() => useSplitViewTool(props))

      expectToolRegistration(1, {
        tooltip: 'code_block.split.label'
      })
    })

    it('should re-register tool when viewMode changes', () => {
      const props = createMockProps({ viewMode: 'special' })
      const { rerender } = renderHook((hookProps) => useSplitViewTool(hookProps), {
        initialProps: props
      })

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)

      // Change viewMode and rerender
      const newProps = { ...props, viewMode: 'split' as ViewMode }
      rerender(newProps)

      // Should register tool again with updated state
      expect(mockRegisterTool).toHaveBeenCalledTimes(2)

      // Verify the new registration has correct tooltip
      const secondRegistration = mockRegisterTool.mock.calls[1][0]
      expect(secondRegistration.tooltip).toBe('code_block.split.restore')
    })
  })

  describe('view mode switching', () => {
    it('should call onToggleSplitView when tool is clicked', () => {
      const mockOnToggleSplitView = vi.fn()
      const props = createMockProps({
        onToggleSplitView: mockOnToggleSplitView
      })
      renderHook(() => useSplitViewTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnToggleSplitView).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useSplitViewTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('split-view')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useSplitViewTool(props))
      }).not.toThrow()

      // Should still call useToolManager (but won't actually register)
      expect(mocks.useToolManager).toHaveBeenCalledWith(undefined)
    })

    it('should not break when onToggleSplitView is undefined', () => {
      const props = createMockProps({ onToggleSplitView: undefined })
      renderHook(() => useSplitViewTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()
    })
  })
})
