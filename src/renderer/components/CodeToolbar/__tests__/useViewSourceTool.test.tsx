import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useViewSourceTool } from '@renderer/components/CodeToolbar/hooks/useViewSourceTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
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
  TOOL_SPECS: mocks.TOOL_SPECS
}))

vi.mock('lucide-react', () => ({
  CodeXml: ({ className }: { className?: string }) => <div data-testid="code-icon" className={className} />,
  Eye: ({ className }: { className?: string }) => <div data-testid="eye-icon" className={className} />,
  SquarePen: ({ className }: { className?: string }) => <div data-testid="edit-icon" className={className} />
}))

const createMockProps = (overrides: Partial<Parameters<typeof useViewSourceTool>[0]> = {}) => ({
  enabled: true,
  editable: false,
  viewMode: 'special' as ViewMode,
  onViewModeChange: vi.fn(),
  ...overrides
})

describe('useViewSourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useViewSourceTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('returns null in split mode', () => {
    const { result } = renderHook(() => useViewSourceTool(createMockProps({ viewMode: 'split' })))

    expect(result.current).toBeNull()
  })

  it('returns a view-source tool when not editable', () => {
    const { result } = renderHook(() => useViewSourceTool(createMockProps({ editable: false })))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'view-source',
        type: 'core',
        order: 12,
        tooltip: 'preview.source',
        onClick: expect.any(Function)
      })
    )
  })

  it('returns an edit tool when editable', () => {
    const { result } = renderHook(() => useViewSourceTool(createMockProps({ editable: true })))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'edit',
        type: 'core',
        order: 12,
        tooltip: 'code_block.edit.label'
      })
    )
  })

  it('uses preview tooltip when currently in source mode', () => {
    const { result: editableResult } = renderHook(() =>
      useViewSourceTool(createMockProps({ editable: true, viewMode: 'source' }))
    )
    const { result: readOnlyResult } = renderHook(() =>
      useViewSourceTool(createMockProps({ editable: false, viewMode: 'source' }))
    )

    expect(editableResult.current?.tooltip).toBe('preview.label')
    expect(readOnlyResult.current?.tooltip).toBe('preview.label')
  })

  it('switches from special to source when clicked', () => {
    const mockOnViewModeChange = vi.fn()
    const { result } = renderHook(() =>
      useViewSourceTool(
        createMockProps({
          viewMode: 'special',
          onViewModeChange: mockOnViewModeChange
        })
      )
    )

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockOnViewModeChange).toHaveBeenCalledWith('source')
  })

  it('switches from source to special when clicked', () => {
    const mockOnViewModeChange = vi.fn()
    const { result } = renderHook(() =>
      useViewSourceTool(
        createMockProps({
          viewMode: 'source',
          onViewModeChange: mockOnViewModeChange
        })
      )
    )

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockOnViewModeChange).toHaveBeenCalledWith('special')
  })

  it('updates the returned tool when editability changes', () => {
    const props = createMockProps({ editable: false })
    const { result, rerender } = renderHook((hookProps) => useViewSourceTool(hookProps), {
      initialProps: props
    })

    expect(result.current?.id).toBe('view-source')

    rerender({ ...props, editable: true })

    expect(result.current?.id).toBe('edit')
  })
})
