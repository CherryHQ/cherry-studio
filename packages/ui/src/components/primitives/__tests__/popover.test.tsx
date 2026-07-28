// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Activity, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../popover'
import { PortalContainerProvider } from '../portal-container'

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

function ActivityAnchoredPopover({ visible }: { visible: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div data-testid="custom-anchor">
            <PopoverTrigger asChild>
              <button type="button" data-testid="anchor-trigger">
                Open anchored selector
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent data-testid="anchored-content">Content</PopoverContent>
      </Popover>
    </Activity>
  )
}

const rect = (x: number, y: number, width: number, height: number) => DOMRect.fromRect({ x, y, width, height })

const popperAnchorWidth = () =>
  screen.getByTestId('anchored-content').parentElement?.style.getPropertyValue('--radix-popper-anchor-width')

describe('PopoverContent', () => {
  it('keeps a custom anchor after its Activity is hidden and shown', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.dataset.testid === 'custom-anchor') return rect(120, 40, 260, 36)
      if (this.dataset.testid === 'anchor-trigger') return rect(120, 40, 100, 36)
      return rect(0, 0, 100, 40)
    })

    try {
      const { rerender } = render(<ActivityAnchoredPopover visible />)

      fireEvent.click(screen.getByTestId('anchor-trigger'))
      await waitFor(() => expect(popperAnchorWidth()).toBe('260px'))

      fireEvent.click(screen.getByTestId('anchor-trigger'))
      await waitFor(() => expect(screen.queryByTestId('anchored-content')).not.toBeInTheDocument())

      rerender(<ActivityAnchoredPopover visible={false} />)
      rerender(<ActivityAnchoredPopover visible />)

      fireEvent.click(screen.getByTestId('anchor-trigger'))
      await waitFor(() => expect(popperAnchorWidth()).toBe('260px'))
    } finally {
      rectSpy.mockRestore()
    }
  })

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

  it('renders content into a custom portal container', () => {
    const portalContainer = document.createElement('div')
    document.body.appendChild(portalContainer)

    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent portalContainer={portalContainer} data-testid="content">
          Content
        </PopoverContent>
      </Popover>
    )

    expect(portalContainer).toContainElement(screen.getByTestId('content'))
    portalContainer.remove()
  })

  it('uses the provider portal container by default', () => {
    const portalContainer = document.createElement('div')
    document.body.appendChild(portalContainer)

    try {
      render(
        <PortalContainerProvider container={portalContainer}>
          <Popover open>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent data-testid="content">Content</PopoverContent>
          </Popover>
        </PortalContainerProvider>
      )

      expect(portalContainer).toContainElement(screen.getByTestId('content'))
    } finally {
      portalContainer.remove()
    }
  })

  it('marks content as no-drag so it stays clickable over titlebar drag regions', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent data-testid="content">Content</PopoverContent>
      </Popover>
    )

    expect(screen.getByTestId('content')).toHaveClass('[-webkit-app-region:no-drag]')
  })
})
