import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

import MathInputDialog from '../MathInputDialog'

afterEach(() => vi.useRealTimers())

describe('MathInputDialog close animation', () => {
  it('retains the formula and placement while closing after its opener clears the position', async () => {
    vi.useFakeTimers()
    const position = { x: 300, y: 200 }
    const view = (visible: boolean) => (
      <MathInputDialog
        visible={visible}
        position={visible ? position : undefined}
        defaultValue={visible ? 'x^2' : ''}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const { rerender } = render(view(true))
    const input = screen.getByRole('textbox')

    rerender(view(false))
    expect(input).toHaveValue('x^2')
    expect(input).toBeVisible()
    // Placement must remain fixed while the opener clears its transient editing state.
    expect(input.parentElement).toHaveStyle({ left: '300px', top: '210px' })

    await act(() => vi.advanceTimersByTime(120))
    expect(input).not.toBeInTheDocument()
  })
})
