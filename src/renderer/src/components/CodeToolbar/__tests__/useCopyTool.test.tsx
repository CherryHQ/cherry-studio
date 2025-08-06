import { useCopyTool } from '@renderer/components/CodeToolbar/hooks/useCopyTool'
import { BasicPreviewHandles } from '@renderer/components/Preview'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useTemporaryValue: vi.fn(),
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    copy: {
      id: 'copy',
      type: 'core',
      order: 11
    },
    'copy-image': {
      id: 'copy-image',
      type: 'quick',
      order: 30
    }
  }
}))

vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="check-icon" />,
  Image: () => <div data-testid="image-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <div data-testid="copy-icon" />
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS,
  useToolManager: mocks.useToolManager
}))

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

// Mock useTemporaryValue setters
const mockSetCopiedTemporarily = vi.fn()
const mockSetCopiedImageTemporarily = vi.fn()

describe('useCopyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocks for each test to ensure isolation
    mocks.useTemporaryValue
      .mockImplementationOnce(() => [false, mockSetCopiedTemporarily])
      .mockImplementationOnce(() => [false, mockSetCopiedImageTemporarily])
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useCopyTool>[0]> = {}) => ({
    showPreviewTools: false,
    previewRef: { current: null },
    onCopySource: vi.fn(),
    setTools: vi.fn(),
    ...overrides
  })

  const createMockPreviewHandles = (): BasicPreviewHandles => ({
    pan: vi.fn(),
    zoom: vi.fn(),
    copy: vi.fn(),
    download: vi.fn()
  })

  describe('tool registration', () => {
    it('should register only the copy-source tool when showPreviewTools is false', () => {
      const props = createMockProps({ showPreviewTools: false })
      renderHook(() => useCopyTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expect(mockRegisterTool).toHaveBeenCalledTimes(1)
      expect(mockRegisterTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'copy',
          tooltip: 'code_block.copy.source'
        })
      )
    })

    it('should register only the copy-source tool when previewRef is null', () => {
      const props = createMockProps({ showPreviewTools: true, previewRef: { current: null } })
      renderHook(() => useCopyTool(props))

      expect(mockRegisterTool).toHaveBeenCalledTimes(1)
      expect(mockRegisterTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'copy'
        })
      )
    })

    it('should register both copy-source and copy-image tools when preview is available', () => {
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: createMockPreviewHandles() }
      })

      renderHook(() => useCopyTool(props))

      expect(mockRegisterTool).toHaveBeenCalledTimes(2)

      // Check first tool: copy source
      expect(mockRegisterTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'copy',
          tooltip: 'code_block.copy.source',
          onClick: expect.any(Function)
        })
      )

      // Check second tool: copy image
      expect(mockRegisterTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'copy-image',
          tooltip: 'preview.copy.image',
          onClick: expect.any(Function)
        })
      )
    })
  })

  describe('copy functionality', () => {
    it('should execute copy source behavior when copy-source tool is clicked', () => {
      const mockOnCopySource = vi.fn()
      const props = createMockProps({ onCopySource: mockOnCopySource })
      renderHook(() => useCopyTool(props))

      const copySourceTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        copySourceTool.onClick()
      })

      expect(mockOnCopySource).toHaveBeenCalledTimes(1)
      expect(mockSetCopiedTemporarily).toHaveBeenCalledWith(true)
    })

    it('should execute copy image behavior when copy-image tool is clicked', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })

      renderHook(() => useCopyTool(props))

      // The copy-image tool is the second one registered
      const copyImageTool = mockRegisterTool.mock.calls[1][0]
      act(() => {
        copyImageTool.onClick()
      })

      expect(mockPreviewHandles.copy).toHaveBeenCalledTimes(1)
      expect(mockSetCopiedImageTemporarily).toHaveBeenCalledWith(true)
    })
  })

  describe('cleanup', () => {
    it('should remove both tools on unmount when both are registered', () => {
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: createMockPreviewHandles() }
      })
      const { unmount } = renderHook(() => useCopyTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledTimes(2)
      expect(mockRemoveTool).toHaveBeenCalledWith('copy')
      expect(mockRemoveTool).toHaveBeenCalledWith('copy-image')
    })

    it('should attempt to remove both tools on unmount even if only one is registered', () => {
      const props = createMockProps({ showPreviewTools: false })
      const { unmount } = renderHook(() => useCopyTool(props))

      unmount()

      // The cleanup function is static and always tries to remove both
      expect(mockRemoveTool).toHaveBeenCalledTimes(2)
      expect(mockRemoveTool).toHaveBeenCalledWith('copy')
      expect(mockRemoveTool).toHaveBeenCalledWith('copy-image')
    })
  })

  describe('edge cases', () => {
    it('should handle copy source failure gracefully', () => {
      const mockOnCopySource = vi.fn().mockImplementation(() => {
        throw new Error('Copy failed')
      })
      const props = createMockProps({ onCopySource: mockOnCopySource })
      renderHook(() => useCopyTool(props))

      const copySourceTool = mockRegisterTool.mock.calls[0][0]

      expect(() => {
        act(() => {
          copySourceTool.onClick()
        })
      }).toThrow('Copy failed')

      expect(mockOnCopySource).toHaveBeenCalledTimes(1)
      expect(mockSetCopiedTemporarily).toHaveBeenCalledWith(false)
    })

    it('should handle copy image failure gracefully', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      mockPreviewHandles.copy = vi.fn().mockImplementation(() => {
        throw new Error('Image copy failed')
      })
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })
      renderHook(() => useCopyTool(props))

      const copyImageTool = mockRegisterTool.mock.calls[1][0]

      expect(() => {
        act(() => {
          copyImageTool.onClick()
        })
      }).toThrow('Image copy failed')

      expect(mockPreviewHandles.copy).toHaveBeenCalledTimes(1)
      expect(mockSetCopiedImageTemporarily).toHaveBeenCalledWith(false)
    })
  })
})
