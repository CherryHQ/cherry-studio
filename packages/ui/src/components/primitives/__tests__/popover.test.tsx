// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from '../popover'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

function ControlledForceMountPopover({ onOutsideClick }: { onOutsideClick: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button type="button" onClick={onOutsideClick}>
        Outside target
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button">Open selector</button>
        </PopoverTrigger>
        <PopoverContent forceMount hidden={!open} data-testid="content">
          Content
        </PopoverContent>
      </Popover>
    </div>
  )
}

describe('PopoverContent', () => {
  it('does not render closed content by default', () => {
    render(
      <Popover open={false}>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent data-testid="content">Content</PopoverContent>
      </Popover>
    )

    expect(screen.queryByTestId('content')).not.toBeInTheDocument()
  })

  it('keeps closed content mounted when forceMount is enabled', () => {
    render(
      <Popover open={false}>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent forceMount data-testid="content">
          Content
        </PopoverContent>
      </Popover>
    )

    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('keeps forced content hidden after close without blocking outside interaction or reopen', async () => {
    const onOutsideClick = vi.fn()

    render(<ControlledForceMountPopover onOutsideClick={onOutsideClick} />)

    expect(screen.getByTestId('content')).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Open selector' }))

    await waitFor(() => expect(screen.getByTestId('content')).not.toHaveAttribute('hidden'))

    fireEvent.click(screen.getByRole('button', { name: 'Open selector' }))

    await waitFor(() => expect(screen.getByTestId('content')).toHaveAttribute('hidden'))

    fireEvent.click(screen.getByRole('button', { name: 'Outside target' }))
    expect(onOutsideClick).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open selector' }))

    await waitFor(() => expect(screen.getByTestId('content')).not.toHaveAttribute('hidden'))
  })
})
