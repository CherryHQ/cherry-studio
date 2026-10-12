import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InputBar from '../InputBar'

afterEach(() => vi.useRealTimers())

describe('InputBar', () => {
  it('does not steal focus from model controls when the input rerenders', async () => {
    const user = userEvent.setup()
    const props = { placeholder: 'Ask a model', loading: false, handleKeyDown: vi.fn(), handleChange: vi.fn() }
    const view = render(
      <>
        <InputBar {...props} text="" />
        <button>Model controls</button>
      </>
    )
    await user.click(screen.getByRole('button', { name: 'Model controls' }))
    vi.useFakeTimers()
    view.rerender(
      <>
        <InputBar {...props} text="draft" />
        <button>Model controls</button>
      </>
    )
    await vi.advanceTimersByTimeAsync(10)
    expect(screen.getByRole('button', { name: 'Model controls' })).toHaveFocus()
  })
})
