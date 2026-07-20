import { useExpandTool } from '@renderer/components/CodeToolbar/hooks/useExpandTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  TOOL_SPECS: {
    expand: {
      id: 'expand',
      type: 'core',
      order: 20
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
  ChevronsDownUp: ({ className }: { className?: string }) => <div data-testid="collapse-icon" className={className} />,
  ChevronsUpDown: ({ className }: { className?: string }) => <div data-testid="expand-icon" className={className} />
}))

const createMockProps = (overrides: Partial<Parameters<typeof useExpandTool>[0]> = {}) => ({
  enabled: true,
  expanded: true,
  expandable: true,
  toggle: vi.fn(),
  ...overrides
})

describe('useExpandTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an expand tool when enabled', () => {
    const { result } = renderHook(() => useExpandTool(createMockProps({ expanded: true })))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'expand',
        type: 'core',
        order: 20,
        tooltip: 'code_block.collapse',
        onClick: expect.any(Function),
        visible: expect.any(Function)
      })
    )
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useExpandTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('uses the expand tooltip when the block is collapsed', () => {
    const { result } = renderHook(() => useExpandTool(createMockProps({ expanded: false })))

    expect(result.current?.tooltip).toBe('code_block.expand')
  })

  it('exposes visibility based on expandability', () => {
    const { result: visibleResult } = renderHook(() => useExpandTool(createMockProps({ expandable: true })))
    const { result: hiddenResult } = renderHook(() => useExpandTool(createMockProps({ expandable: false })))

    expect(visibleResult.current?.visible?.()).toBe(true)
    expect(hiddenResult.current?.visible?.()).toBe(false)
  })

  it('executes toggle when clicked', () => {
    const mockToggle = vi.fn()
    const { result } = renderHook(() => useExpandTool(createMockProps({ toggle: mockToggle })))

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('updates the returned tooltip when expanded changes', () => {
    const props = createMockProps({ expanded: true })
    const { result, rerender } = renderHook((hookProps) => useExpandTool(hookProps), {
      initialProps: props
    })

    expect(result.current?.tooltip).toBe('code_block.collapse')

    rerender({ ...props, expanded: false })

    expect(result.current?.tooltip).toBe('code_block.expand')
  })
})
