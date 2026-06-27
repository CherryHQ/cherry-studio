import { useWrapTool } from '@renderer/components/CodeToolbar/hooks/useWrapTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  TOOL_SPECS: {
    wrap: {
      id: 'wrap',
      type: 'quick',
      order: 13
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
  Text: ({ className }: { className?: string }) => <div data-testid="text-icon" className={className} />,
  WrapText: ({ className }: { className?: string }) => <div data-testid="wrap-text-icon" className={className} />
}))

const createMockProps = (overrides: Partial<Parameters<typeof useWrapTool>[0]> = {}) => ({
  enabled: true,
  wrapped: true,
  wrappable: true,
  toggle: vi.fn(),
  ...overrides
})

describe('useWrapTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a wrap tool when enabled', () => {
    const { result } = renderHook(() => useWrapTool(createMockProps({ wrapped: true })))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'wrap',
        type: 'quick',
        order: 13,
        tooltip: 'code_block.wrap.off',
        onClick: expect.any(Function),
        visible: expect.any(Function)
      })
    )
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useWrapTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('uses the enable wrapping tooltip when currently unwrapped', () => {
    const { result } = renderHook(() => useWrapTool(createMockProps({ wrapped: false })))

    expect(result.current?.tooltip).toBe('code_block.wrap.on')
  })

  it('exposes visibility based on wrappability', () => {
    const { result: visibleResult } = renderHook(() => useWrapTool(createMockProps({ wrappable: true })))
    const { result: hiddenResult } = renderHook(() => useWrapTool(createMockProps({ wrappable: false })))
    const { result: undefinedResult } = renderHook(() => useWrapTool(createMockProps({ wrappable: undefined })))

    expect(visibleResult.current?.visible?.()).toBe(true)
    expect(hiddenResult.current?.visible?.()).toBe(false)
    expect(undefinedResult.current?.visible?.()).toBe(false)
  })

  it('executes toggle when clicked', () => {
    const mockToggle = vi.fn()
    const { result } = renderHook(() => useWrapTool(createMockProps({ toggle: mockToggle })))

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('updates the returned tooltip when wrapped changes', () => {
    const props = createMockProps({ wrapped: true })
    const { result, rerender } = renderHook((hookProps) => useWrapTool(hookProps), {
      initialProps: props
    })

    expect(result.current?.tooltip).toBe('code_block.wrap.off')

    rerender({ ...props, wrapped: false })

    expect(result.current?.tooltip).toBe('code_block.wrap.on')
  })
})
