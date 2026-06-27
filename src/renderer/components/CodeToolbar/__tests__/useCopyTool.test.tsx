import { useCopyTool } from '@renderer/components/CodeToolbar/hooks/useCopyTool'
import type { BasicPreviewHandles } from '@renderer/components/Preview'
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useTemporaryValue: vi.fn(),
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
  Check: ({ className, color }: { className?: string; color?: string }) => (
    <div data-color={color} data-testid="check-icon" className={className} />
  ),
  Image: ({ className }: { className?: string }) => <div data-testid="image-icon" className={className} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: ({ className }: { className?: string }) => <div data-testid="copy-icon" className={className} />
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS
}))

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: mocks.useTemporaryValue
}))

const mockSetCopiedTemporarily = vi.fn()
const mockSetCopiedImageTemporarily = vi.fn()

const mockTemporaryValues = (copied = false, copiedImage = false) => {
  mocks.useTemporaryValue.mockReset()
  mocks.useTemporaryValue
    .mockImplementationOnce(() => [copied, mockSetCopiedTemporarily])
    .mockImplementationOnce(() => [copiedImage, mockSetCopiedImageTemporarily])
}

const createMockPreviewHandles = (): BasicPreviewHandles => ({
  pan: vi.fn(),
  zoom: vi.fn(),
  copy: vi.fn(),
  download: vi.fn()
})

const createMockProps = (overrides: Partial<Parameters<typeof useCopyTool>[0]> = {}) => ({
  showPreviewTools: false,
  previewRef: { current: null },
  onCopySource: vi.fn(),
  ...overrides
})

describe('useCopyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTemporaryValues()
  })

  it('returns only the copy-source tool when preview tools are disabled', () => {
    const { result } = renderHook(() => useCopyTool(createMockProps({ showPreviewTools: false })))

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toEqual(
      expect.objectContaining({
        id: 'copy',
        tooltip: 'code_block.copy.source',
        onClick: expect.any(Function)
      })
    )
  })

  it('returns copy-source and copy-image tools when preview tools are enabled', () => {
    const { result } = renderHook(() =>
      useCopyTool(
        createMockProps({
          showPreviewTools: true,
          previewRef: { current: createMockPreviewHandles() }
        })
      )
    )

    expect(result.current.map((tool) => tool.id)).toEqual(['copy', 'copy-image'])
    expect(result.current[1]).toEqual(
      expect.objectContaining({
        id: 'copy-image',
        tooltip: 'preview.copy.image',
        onClick: expect.any(Function)
      })
    )
  })

  it('executes copy source behavior when the copy-source tool is clicked', () => {
    const mockOnCopySource = vi.fn()
    const { result } = renderHook(() => useCopyTool(createMockProps({ onCopySource: mockOnCopySource })))

    act(() => {
      result.current[0].onClick?.()
    })

    expect(mockOnCopySource).toHaveBeenCalledTimes(1)
    expect(mockSetCopiedTemporarily).toHaveBeenCalledWith(true)
  })

  it('resets copied state and rethrows when source copy fails', () => {
    const copyError = new Error('copy failed')
    const { result } = renderHook(() =>
      useCopyTool(
        createMockProps({
          onCopySource: vi.fn(() => {
            throw copyError
          })
        })
      )
    )

    expect(() => {
      act(() => {
        result.current[0].onClick?.()
      })
    }).toThrow(copyError)
    expect(mockSetCopiedTemporarily).toHaveBeenCalledWith(false)
  })

  it('executes preview copy behavior when the copy-image tool is clicked', () => {
    const previewHandles = createMockPreviewHandles()
    const { result } = renderHook(() =>
      useCopyTool(
        createMockProps({
          showPreviewTools: true,
          previewRef: { current: previewHandles }
        })
      )
    )

    act(() => {
      result.current[1].onClick?.()
    })

    expect(previewHandles.copy).toHaveBeenCalledTimes(1)
    expect(mockSetCopiedImageTemporarily).toHaveBeenCalledWith(true)
  })

  it('uses temporary success icons for copied source and image states', () => {
    mockTemporaryValues(true, true)

    const { result } = renderHook(() =>
      useCopyTool(
        createMockProps({
          showPreviewTools: true,
          previewRef: { current: createMockPreviewHandles() }
        })
      )
    )

    render(
      <>
        {result.current[0].icon}
        {result.current[1].icon}
      </>
    )

    expect(screen.getAllByTestId('check-icon')).toHaveLength(2)
  })
})
