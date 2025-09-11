import { useDownloadTool } from '@renderer/components/CodeToolbar/hooks/useDownloadTool'
import { BasicPreviewHandles } from '@renderer/components/Preview'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useToolManager: vi.fn(),
  TOOL_SPECS: {
    download: {
      id: 'download',
      type: 'core',
      order: 10
    },
    'download-svg': {
      id: 'download-svg',
      type: 'quick',
      order: 31
    },
    'download-png': {
      id: 'download-png',
      type: 'quick',
      order: 32
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/Icons', () => ({
  FilePngIcon: () => <div data-testid="file-png-icon" />,
  FileSvgIcon: () => <div data-testid="file-svg-icon" />
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

describe('useDownloadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Note: mock implementations are already set in vi.hoisted() above
  })

  // Helper function to create mock props
  const createMockProps = (overrides: Partial<Parameters<typeof useDownloadTool>[0]> = {}) => {
    const defaultProps = {
      showPreviewTools: false,
      previewRef: { current: null },
      onDownloadSource: vi.fn(),
      setTools: vi.fn()
    }

    return { ...defaultProps, ...overrides }
  }

  // Helper function to create mock preview handles
  const createMockPreviewHandles = (): BasicPreviewHandles => ({
    pan: vi.fn(),
    zoom: vi.fn(),
    copy: vi.fn(),
    download: vi.fn()
  })

  // Helper function for tool registration assertions
  const expectToolRegistration = (times: number, toolConfig?: object) => {
    expect(mockRegisterTool).toHaveBeenCalledTimes(times)
    if (times > 0 && toolConfig) {
      expect(mockRegisterTool).toHaveBeenCalledWith(expect.objectContaining(toolConfig))
    }
  }

  const expectNoChildren = () => {
    const registeredTool = mockRegisterTool.mock.calls[0][0]
    expect(registeredTool).not.toHaveProperty('children')
  }

  describe('tool registration', () => {
    it('should register single download tool when showPreviewTools is false', () => {
      const props = createMockProps({ showPreviewTools: false })
      renderHook(() => useDownloadTool(props))

      expect(mocks.useToolManager).toHaveBeenCalledWith(props.setTools)
      expectToolRegistration(1, {
        id: 'download',
        type: 'core',
        order: 10,
        tooltip: 'code_block.download.source',
        onClick: expect.any(Function),
        icon: expect.any(Object)
      })
      expectNoChildren()
    })

    it('should register single download tool when showPreviewTools is true but previewRef.current is null', () => {
      const props = createMockProps({ showPreviewTools: true, previewRef: { current: null } })
      renderHook(() => useDownloadTool(props))

      expectToolRegistration(1, {
        id: 'download',
        type: 'core',
        order: 10,
        tooltip: 'code_block.download.source', // When previewRef.current is null, showPreviewTools is false
        onClick: expect.any(Function),
        icon: expect.any(Object)
      })
      expectNoChildren()
    })

    it('should register download tool with children when showPreviewTools is true and previewRef.current is not null', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })

      renderHook(() => useDownloadTool(props))

      expectToolRegistration(1, {
        id: 'download',
        type: 'core',
        order: 10,
        tooltip: undefined,
        icon: expect.any(Object),
        children: expect.arrayContaining([
          expect.objectContaining({
            id: 'download',
            type: 'core',
            order: 10,
            tooltip: 'code_block.download.source',
            onClick: expect.any(Function),
            icon: expect.any(Object)
          }),
          expect.objectContaining({
            id: 'download-svg',
            type: 'quick',
            order: 31,
            tooltip: 'code_block.download.svg',
            onClick: expect.any(Function),
            icon: expect.any(Object)
          }),
          expect.objectContaining({
            id: 'download-png',
            type: 'quick',
            order: 32,
            tooltip: 'code_block.download.png',
            onClick: expect.any(Function),
            icon: expect.any(Object)
          })
        ])
      })
    })
  })

  describe('download functionality', () => {
    it('should execute download source behavior when tool is activated', () => {
      const mockOnDownloadSource = vi.fn()
      const props = createMockProps({ onDownloadSource: mockOnDownloadSource })
      renderHook(() => useDownloadTool(props))

      // Get the onClick handler from the registered tool
      const registeredTool = mockRegisterTool.mock.calls[0][0]
      act(() => {
        registeredTool.onClick()
      })

      expect(mockOnDownloadSource).toHaveBeenCalledTimes(1)
    })

    it('should execute download SVG behavior when SVG download tool is activated', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })

      renderHook(() => useDownloadTool(props))

      // Get the download-svg child tool
      const registeredTool = mockRegisterTool.mock.calls[0][0]
      const downloadSvgTool = registeredTool.children?.find((child: any) => child.tooltip === 'code_block.download.svg')

      expect(downloadSvgTool).toBeDefined()

      act(() => {
        downloadSvgTool.onClick()
      })

      expect(mockPreviewHandles.download).toHaveBeenCalledTimes(1)
      expect(mockPreviewHandles.download).toHaveBeenCalledWith('svg')
    })

    it('should execute download PNG behavior when PNG download tool is activated', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })

      renderHook(() => useDownloadTool(props))

      // Get the download-png child tool
      const registeredTool = mockRegisterTool.mock.calls[0][0]
      const downloadPngTool = registeredTool.children?.find((child: any) => child.tooltip === 'code_block.download.png')

      expect(downloadPngTool).toBeDefined()

      act(() => {
        downloadPngTool.onClick()
      })

      expect(mockPreviewHandles.download).toHaveBeenCalledTimes(1)
      expect(mockPreviewHandles.download).toHaveBeenCalledWith('png')
    })

    it('should execute download source behavior from child tool', () => {
      const mockOnDownloadSource = vi.fn()
      const props = createMockProps({
        showPreviewTools: true,
        onDownloadSource: mockOnDownloadSource,
        previewRef: { current: createMockPreviewHandles() }
      })

      renderHook(() => useDownloadTool(props))

      // Get the download source child tool
      const registeredTool = mockRegisterTool.mock.calls[0][0]
      const downloadSourceTool = registeredTool.children?.find(
        (child: any) => child.tooltip === 'code_block.download.source'
      )

      expect(downloadSourceTool).toBeDefined()

      act(() => {
        downloadSourceTool.onClick()
      })

      expect(mockOnDownloadSource).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('should remove tool on unmount', () => {
      const props = createMockProps()
      const { unmount } = renderHook(() => useDownloadTool(props))

      unmount()

      expect(mockRemoveTool).toHaveBeenCalledWith('download')
    })
  })

  describe('edge cases', () => {
    it('should handle missing setTools gracefully', () => {
      const props = createMockProps({ setTools: undefined })

      expect(() => {
        renderHook(() => useDownloadTool(props))
      }).not.toThrow()

      // Should still call useToolManager (but won't actually register)
      expect(mocks.useToolManager).toHaveBeenCalledWith(undefined)
    })

    it('should handle missing previewRef.current gracefully', () => {
      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: null }
      })

      expect(() => {
        renderHook(() => useDownloadTool(props))
      }).not.toThrow()

      // Should register single tool without children
      expectToolRegistration(1)
      const registeredTool = mockRegisterTool.mock.calls[0][0]
      expect(registeredTool).not.toHaveProperty('children')
    })

    it('should handle download source operation failures gracefully', () => {
      const mockOnDownloadSource = vi.fn().mockImplementation(() => {
        throw new Error('Download failed')
      })

      const props = createMockProps({ onDownloadSource: mockOnDownloadSource })
      renderHook(() => useDownloadTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]

      // Errors should be propagated up
      expect(() => {
        act(() => {
          registeredTool.onClick()
        })
      }).toThrow('Download failed')

      // Callback should still be called
      expect(mockOnDownloadSource).toHaveBeenCalledTimes(1)
    })

    it('should handle download image operation failures gracefully', () => {
      const mockPreviewHandles = createMockPreviewHandles()
      mockPreviewHandles.download = vi.fn().mockImplementation(() => {
        throw new Error('Image download failed')
      })

      const props = createMockProps({
        showPreviewTools: true,
        previewRef: { current: mockPreviewHandles }
      })

      renderHook(() => useDownloadTool(props))

      const registeredTool = mockRegisterTool.mock.calls[0][0]
      const downloadSvgTool = registeredTool.children?.find((child: any) => child.tooltip === 'code_block.download.svg')

      expect(downloadSvgTool).toBeDefined()

      // Errors should be propagated up
      expect(() => {
        act(() => {
          downloadSvgTool.onClick()
        })
      }).toThrow('Image download failed')

      // Callback should still be called
      expect(mockPreviewHandles.download).toHaveBeenCalledTimes(1)
      expect(mockPreviewHandles.download).toHaveBeenCalledWith('svg')
    })
  })
})
