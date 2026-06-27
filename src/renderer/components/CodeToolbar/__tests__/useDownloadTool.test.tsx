import { useDownloadTool } from '@renderer/components/CodeToolbar/hooks/useDownloadTool'
import type { BasicPreviewHandles } from '@renderer/components/Preview'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
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

vi.mock('lucide-react', () => ({
  Download: ({ className }: { className?: string }) => <div data-testid="download-icon" className={className} />,
  FileCode: () => <div data-testid="file-code-icon" />
}))

vi.mock('@renderer/components/Icons', () => ({
  FilePngIcon: () => <div data-testid="file-png-icon" />,
  FileSvgIcon: () => <div data-testid="file-svg-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS
}))

const createMockPreviewHandles = (): BasicPreviewHandles => ({
  pan: vi.fn(),
  zoom: vi.fn(),
  copy: vi.fn(),
  download: vi.fn()
})

const createMockProps = (overrides: Partial<Parameters<typeof useDownloadTool>[0]> = {}) => ({
  showPreviewTools: false,
  previewRef: { current: null },
  onDownloadSource: vi.fn(),
  ...overrides
})

describe('useDownloadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a source download tool when preview tools are disabled', () => {
    const mockOnDownloadSource = vi.fn()
    const { result } = renderHook(() =>
      useDownloadTool(createMockProps({ showPreviewTools: false, onDownloadSource: mockOnDownloadSource }))
    )

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'download',
        tooltip: 'code_block.download.source',
        onClick: expect.any(Function)
      })
    )

    act(() => {
      result.current.onClick?.()
    })

    expect(mockOnDownloadSource).toHaveBeenCalledTimes(1)
  })

  it('returns a download menu with source, svg, and png actions when preview tools are enabled', () => {
    const mockOnDownloadSource = vi.fn()
    const previewHandles = createMockPreviewHandles()
    const { result } = renderHook(() =>
      useDownloadTool(
        createMockProps({
          showPreviewTools: true,
          previewRef: { current: previewHandles },
          onDownloadSource: mockOnDownloadSource
        })
      )
    )

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'download',
        tooltip: undefined,
        children: expect.any(Array)
      })
    )
    expect(result.current.children?.map((tool) => tool.id)).toEqual(['download', 'download-svg', 'download-png'])

    act(() => {
      result.current.children?.[0].onClick?.()
      result.current.children?.[1].onClick?.()
      result.current.children?.[2].onClick?.()
    })

    expect(mockOnDownloadSource).toHaveBeenCalledTimes(1)
    expect(previewHandles.download).toHaveBeenNthCalledWith(1, 'svg')
    expect(previewHandles.download).toHaveBeenNthCalledWith(2, 'png')
  })

  it('guards preview download actions when the preview ref is not available yet', () => {
    const { result } = renderHook(() => useDownloadTool(createMockProps({ showPreviewTools: true })))

    expect(() => {
      act(() => {
        result.current.children?.[1].onClick?.()
        result.current.children?.[2].onClick?.()
      })
    }).not.toThrow()
  })
})
