import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useOverlayTriggerTooltip } from '../useOverlayTriggerTooltip'

describe('useOverlayTriggerTooltip', () => {
  it('tracks normal tooltip open changes', () => {
    const { result } = renderHook(() => useOverlayTriggerTooltip())

    act(() => {
      result.current.tooltipProps.onOpenChange(true)
    })

    expect(result.current.tooltipProps.isOpen).toBe(true)

    act(() => {
      result.current.tooltipProps.onOpenChange(false)
    })

    expect(result.current.tooltipProps.isOpen).toBe(false)
  })

  it('keeps the tooltip closed after an overlay trigger until released', () => {
    const trigger = { blur: vi.fn() }
    const { result } = renderHook(() => useOverlayTriggerTooltip())

    act(() => {
      result.current.tooltipProps.onOpenChange(true)
    })
    expect(result.current.tooltipProps.isOpen).toBe(true)

    act(() => {
      result.current.suppress(trigger)
    })

    expect(trigger.blur).toHaveBeenCalledTimes(1)
    expect(result.current.tooltipProps.isOpen).toBe(false)

    act(() => {
      result.current.tooltipProps.onOpenChange(true)
    })

    expect(result.current.tooltipProps.isOpen).toBe(false)

    act(() => {
      result.current.triggerProps.onPointerLeave()
      result.current.tooltipProps.onOpenChange(true)
    })

    expect(result.current.tooltipProps.isOpen).toBe(true)
  })
})
