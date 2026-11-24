import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROMPT_DOCK_IDLE_DELAY_MS, usePromptDockAutoHide } from '../usePromptDockAutoHide'

function Harness({ enabled = true, paused = false }: { enabled?: boolean; paused?: boolean }) {
  const { dockRef, idle, markActive, scheduleIdle } = usePromptDockAutoHide({ enabled, paused })
  return (
    <div
      ref={dockRef}
      data-testid="dock"
      data-idle={idle ? 'true' : 'false'}
      onPointerMove={markActive}
      onFocusCapture={markActive}
      onBlurCapture={scheduleIdle}
    />
  )
}

describe('usePromptDockAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('dims the dock after idle and restores on activity', () => {
    render(<Harness />)
    expect(screen.getByTestId('dock')).toHaveAttribute('data-idle', 'false')

    act(() => {
      vi.advanceTimersByTime(PROMPT_DOCK_IDLE_DELAY_MS + 100)
    })
    expect(screen.getByTestId('dock')).toHaveAttribute('data-idle', 'true')

    act(() => {
      fireEvent.pointerMove(screen.getByTestId('dock'))
    })
    expect(screen.getByTestId('dock')).toHaveAttribute('data-idle', 'false')
  })

  it('stays visible when disabled or paused', () => {
    const { rerender } = render(<Harness enabled={false} />)
    act(() => {
      vi.advanceTimersByTime(PROMPT_DOCK_IDLE_DELAY_MS + 1000)
    })
    expect(screen.getByTestId('dock')).toHaveAttribute('data-idle', 'false')

    rerender(<Harness enabled paused />)
    act(() => {
      vi.advanceTimersByTime(PROMPT_DOCK_IDLE_DELAY_MS + 1000)
    })
    expect(screen.getByTestId('dock')).toHaveAttribute('data-idle', 'false')
  })
})
