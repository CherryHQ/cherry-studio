import { useSaveTool } from '@renderer/components/CodeToolbar/hooks/useSaveTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  useTemporaryValue: vi.fn(),
  TOOL_SPECS: {
    save: {
      id: 'save',
      type: 'core',
      order: 14
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

// Mock useTemporaryValue
const mockSetTemporaryValue = vi.fn()
mocks.useTemporaryValue.mockImplementation(() => [false, mockSetTemporaryValue])

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: mocks.useTemporaryValue
}))

// Mock useToolManager
const mockRegisterTool = vi.fn()
const mockRemoveTool = vi.fn()
mocks.useToolManager.mockImplementation(() => ({
  registerTool: mockRegisterTool,
  removeTool: mockRemoveTool
}))

vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="check-icon" />,
  SaveIcon: () => <div data-testid="save-icon" />
}))

describe('useSaveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default values
    mocks.useTemporaryValue.mockImplementation(() => [false, mockSetTemporaryValue])
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useSaveTool>[0]> = {}) => {
    const defaultProps = {
      enabled: true,
      sourceViewRef: { current: null },
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
    it('should register save tool when enabled', () => {
      const props = createMockProps({ enabled: true })
      renderHook(() => useSaveTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expectToolRegistration(1, {
        id: 'save',
        type: 'core',
        order: 14,
        tooltip: 'code_block.edit.save.label',
        onClick: expect.any(Function)
      })
    })

    it('should not register tool when disabled', () => {
      const props = createMockProps({ enabled: false })
      renderHook(() => useSaveTool(props))

      expect(mockRegisterTool).not.toHaveBeenCalled()
    })

    it('should re-register tool when saved state changes', () => {
      // Initially not saved
      mocks.useTemporaryValue.mockImplementation(() => [false, mockSetTemporaryValue])
      const props = createMockProps()
      const { rerender } = renderHook(() => useSaveTool(props))

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)

      // Change to saved state and rerender
      mocks.useTemporaryValue.mockImplementation(() => [true, mockSetTemporaryValue])
      rerender()

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)
    })
  })

  describe('save functionality', () => {
    it('should execute save behavior when tool is clicked', () => {
      const mockSave = vi.fn()
      const mockEditorHandles = { save: mockSave }
      const props = createMockProps({
        sourceViewRef: { current: mockEditorHandles }
      })
      renderHook(() => useSaveTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockSave).toHaveBeenCalledTimes(1)
      expect(mockSetTemporaryValue).toHaveBeenCalledWith(true)
    })

    it('should handle when sourceViewRef.current is null', () => {
      const props = createMockProps({
        sourceViewRef: { current: null }
      })
      renderHook(() => useSaveTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()

      expect(mockSetTemporaryValue).toHaveBeenCalledWith(true)
    })

    it('should handle when sourceViewRef.current.save is undefined', () => {
      const props = createMockProps({
        sourceViewRef: { current: {} }
      })
      renderHook(() => useSaveTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).not.toThrow()

      expect(mockSetTemporaryValue).toHaveBeenCalledWith(true)
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useSaveTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('save')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useSaveTool(props))
      }).not.toThrow()

      // Should still call useToolManager (but won't actually register)
      expect(mocks.useToolManager).toHaveBeenCalledWith(undefined)
    })
  })
})
