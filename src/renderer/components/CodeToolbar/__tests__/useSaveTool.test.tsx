import { useSaveTool } from '@renderer/components/CodeToolbar/hooks/useSaveTool'
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  i18n: {
    t: vi.fn((key: string) => key)
  },
  useTemporaryValue: vi.fn(),
  TOOL_SPECS: {
    save: {
      id: 'save',
      type: 'core',
      order: 13
    }
  }
}))

vi.mock('lucide-react', () => ({
  Check: ({ className, color }: { className?: string; color?: string }) => (
    <div data-color={color} data-testid="check-icon" className={className} />
  ),
  SaveIcon: ({ className }: { className?: string }) => <div data-testid="save-icon" className={className} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/components/ActionTools', () => ({
  TOOL_SPECS: mocks.TOOL_SPECS
}))

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: mocks.useTemporaryValue
}))

const mockSetSavedTemporarily = vi.fn()

const mockTemporaryValue = (saved = false) => {
  mocks.useTemporaryValue.mockReset()
  mocks.useTemporaryValue.mockImplementation(() => [saved, mockSetSavedTemporarily])
}

const createMockProps = (overrides: Partial<Parameters<typeof useSaveTool>[0]> = {}) => ({
  enabled: true,
  sourceViewRef: { current: { save: vi.fn() } },
  ...overrides
})

describe('useSaveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTemporaryValue()
  })

  it('returns null when disabled', () => {
    const { result } = renderHook(() => useSaveTool(createMockProps({ enabled: false })))

    expect(result.current).toBeNull()
  })

  it('returns a save tool when enabled', () => {
    const { result } = renderHook(() => useSaveTool(createMockProps()))

    expect(result.current).toEqual(
      expect.objectContaining({
        id: 'save',
        type: 'core',
        order: 13,
        tooltip: 'code_block.edit.save.label',
        onClick: expect.any(Function)
      })
    )
  })

  it('executes save behavior when clicked', () => {
    const mockSave = vi.fn()
    const { result } = renderHook(() =>
      useSaveTool(
        createMockProps({
          sourceViewRef: { current: { save: mockSave } }
        })
      )
    )

    act(() => {
      result.current?.onClick?.()
    })

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSetSavedTemporarily).toHaveBeenCalledWith(true)
  })

  it('handles a missing editor ref without throwing', () => {
    const { result } = renderHook(() =>
      useSaveTool(
        createMockProps({
          sourceViewRef: { current: null }
        })
      )
    )

    expect(() => {
      act(() => {
        result.current?.onClick?.()
      })
    }).not.toThrow()
    expect(mockSetSavedTemporarily).toHaveBeenCalledWith(true)
  })

  it('uses the temporary success icon when saved', () => {
    mockTemporaryValue(true)

    const { result } = renderHook(() => useSaveTool(createMockProps()))

    render(<>{result.current?.icon}</>)

    expect(screen.getByTestId('check-icon')).toBeInTheDocument()
  })
})
