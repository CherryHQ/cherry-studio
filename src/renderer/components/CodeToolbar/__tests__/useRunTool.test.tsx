import { useRunTool } from '@renderer/components/CodeToolbar/hooks/useRunTool'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  TOOL_SPECS: {
    run: {
      id: 'run',
      type: 'quick',
      order: 11
    }
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: ({ className }: { className?: string }) => <div data-testid="loading-icon" className={className} />
}))

vi.mock('lucide-react', () => ({
  CirclePlay: ({ className }: { className?: string }) => <div data-testid="play-icon" className={className} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS
}))

const createMockProps = (overrides: Partial<Parameters<typeof useRunTool>[0]> = {}) => ({
  enabled: true,
  isRunning: false,
  onRun: vi.fn(),
  ...overrides
})

describe('useRunTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useRunTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('returns a run tool when enabled', () => {
    const { result } = renderHook(() => useRunTool(createMockProps()))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'run',
        type: 'quick',
        order: 11,
        tooltip: 'code_block.run',
        onClick: expect.any(Function)
      })
    )
  })

  it('executes run behavior when clicked and not already running', () => {
    const mockOnRun = vi.fn()
    const { result } = renderHook(() => useRunTool(createMockProps({ onRun: mockOnRun, isRunning: false })))

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockOnRun).toHaveBeenCalledTimes(1)
  })

  it('does not execute run behavior while already running', () => {
    const mockOnRun = vi.fn()
    const { result } = renderHook(() => useRunTool(createMockProps({ onRun: mockOnRun, isRunning: true })))

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockOnRun).not.toHaveBeenCalled()
  })

  it('keeps the same tool id and updates when running state changes', () => {
    const props = createMockProps({ isRunning: false })
    const { result, rerender } = renderHook((hookProps) => useRunTool(hookProps), {
      initialProps: props
    })

    expect(result.current?.id).toBe('run')

    rerender({ ...props, isRunning: true })

    expect(result.current?.id).toBe('run')
    expect(result.current?.tooltip).toBe('code_block.run')
  })
})
