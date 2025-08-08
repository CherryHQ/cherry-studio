import { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useViewSourceTool } from '@renderer/components/CodeToolbar/hooks/useViewSourceTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    edit: {
      id: 'edit',
      type: 'core',
      order: 12
    },
    'view-source': {
      id: 'view-source',
      type: 'core',
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

const mockRegisterTool = vi.fn()
const mockRemoveTool = vi.fn()
mocks.useToolManager.mockImplementation(() => ({
  registerTool: mockRegisterTool,
  removeTool: mockRemoveTool
}))

describe('useViewSourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockProps = (overrides: Partial<Parameters<typeof useViewSourceTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      editable: false,
      viewMode: 'special' as ViewMode,
      onViewModeChange: vi.fn(),
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
      renderHook(() => useViewSourceTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should not register tool when in split mode', () => {
      const props = createMockProps({ viewMode: 'split' })
      renderHook(() => useViewSourceTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should register view-source tool when not editable', () => {
      const props = createMockProps({ editable: false })
      renderHook(() => useViewSourceTool(props))

      expectToolRegistration(1, {
        id: 'view-source',
        type: 'core',
        order: 12
      })
    })

    it('should register edit tool when editable', () => {
      const props = createMockProps({ editable: true })
      renderHook(() => useViewSourceTool(props))

      expectToolRegistration(1, {
        id: 'edit',
        type: 'core',
        order: 12
      })
    })

    it('should re-register tool when editable changes', () => {
      const props = createMockProps({ editable: false })
      const { rerender } = renderHook((hookProps) => useViewSourceTool(hookProps), {
        initialProps: props
      })

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)

      const newProps = { ...props, editable: true }
      rerender(newProps)

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)
      expect(mockRemoveTool).toHaveBeenCalledWith('view-source')
    })
  })

  describe('tooltip variations', () => {
    it('should show correct tooltips for edit mode', () => {
      const props = createMockProps({ editable: true, viewMode: 'source' })
      renderHook(() => useViewSourceTool(props))

      expectToolRegistration(1, {
        tooltip: 'preview.label'
      })

      vi.clearAllMocks()

      const propsSpecial = createMockProps({ editable: true, viewMode: 'special' })
      renderHook(() => useViewSourceTool(propsSpecial))

      expectToolRegistration(1, {
        tooltip: 'code_block.edit.label'
      })
    })

    it('should show correct tooltips for view-source mode', () => {
      const props = createMockProps({ editable: false, viewMode: 'source' })
      renderHook(() => useViewSourceTool(props))

      expectToolRegistration(1, {
        tooltip: 'preview.label'
      })

      vi.clearAllMocks()

      const propsSpecial = createMockProps({ editable: false, viewMode: 'special' })
      renderHook(() => useViewSourceTool(propsSpecial))

      expectToolRegistration(1, {
        tooltip: 'preview.source'
      })
    })
  })

  describe('view mode switching', () => {
    it('should switch from special to source when tool is clicked', () => {
      const mockOnViewModeChange = vi.fn()
      const props = createMockProps({
        viewMode: 'special',
        onViewModeChange: mockOnViewModeChange
      })
      renderHook(() => useViewSourceTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnViewModeChange).toHaveBeenCalledWith('source')
    })

    it('should switch from source to special when tool is clicked', () => {
      const mockOnViewModeChange = vi.fn()
      const props = createMockProps({
        viewMode: 'source',
        onViewModeChange: mockOnViewModeChange
      })
      renderHook(() => useViewSourceTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnViewModeChange).toHaveBeenCalledWith('special')
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useViewSourceTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('view-source')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useViewSourceTool(props))
      }).not.toThrow()
    })

    it('should not break when onViewModeChange is undefined', () => {
      const props = createMockProps({ onViewModeChange: undefined })
      renderHook(() => useViewSourceTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()
    })
  })
})
