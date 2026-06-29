import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useSplitViewTool } from '@renderer/components/CodeToolbar/hooks/useSplitViewTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
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
  TOOL_SPECS: mocks.TOOL_SPECS
}))

vi.mock('lucide-react', () => ({
  Square: ({ className }: { className?: string }) => <div data-testid="square-icon" className={className} />,
  SquareSplitHorizontal: ({ className }: { className?: string }) => (
    <div data-testid="split-icon" className={className} />
  )
}))

const createMockProps = (overrides: Partial<Parameters<typeof useSplitViewTool>[0]> = {}) => ({
  enabled: true,
  viewMode: 'special' as ViewMode,
  onToggleSplitView: vi.fn(),
  ...overrides
})

describe('useSplitViewTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useSplitViewTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('returns a split-view tool when enabled', () => {
    const { result } = renderHook(() => useSplitViewTool(createMockProps()))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'split-view',
        type: 'quick',
        order: 10,
        tooltip: 'code_block.split.label',
        onClick: expect.any(Function)
      })
    )
  })

  it('uses restore tooltip when already in split mode', () => {
    const { result } = renderHook(() => useSplitViewTool(createMockProps({ viewMode: 'split' })))

    expect(result.current?.tooltip).toBe('code_block.split.restore')
  })

  it('calls onToggleSplitView when clicked', () => {
    const mockOnToggleSplitView = vi.fn()
    const { result } = renderHook(() => useSplitViewTool(createMockProps({ onToggleSplitView: mockOnToggleSplitView })))

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockOnToggleSplitView).toHaveBeenCalledTimes(1)
  })

  it('updates the returned tooltip when view mode changes', () => {
    const props = createMockProps({ viewMode: 'special' })
    const { result, rerender } = renderHook((hookProps) => useSplitViewTool(hookProps), {
      initialProps: props
    })

    expect(result.current?.tooltip).toBe('code_block.split.label')

    rerender({ ...props, viewMode: 'split' })

    expect(result.current?.tooltip).toBe('code_block.split.restore')
  })
})
