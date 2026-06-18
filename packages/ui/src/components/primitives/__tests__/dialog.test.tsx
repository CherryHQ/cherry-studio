// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from '../dialog'

afterEach(() => {
  cleanup()
})

describe('Dialog primitive', () => {
  it('stops pointerdown events inside content from reaching React ancestors', () => {
    const handleAncestorPointerDown = vi.fn()

    render(
      <div onPointerDown={handleAncestorPointerDown}>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Rename item</DialogTitle>
            <input aria-label="Name" />
          </DialogContent>
        </Dialog>
      </div>
    )

    fireEvent.pointerDown(screen.getByLabelText('Name'))

    expect(handleAncestorPointerDown).not.toHaveBeenCalled()
  })

  it('stops pointerdown events on the overlay from reaching React ancestors', () => {
    const handleAncestorPointerDown = vi.fn()

    render(
      <div onPointerDown={handleAncestorPointerDown}>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Rename item</DialogTitle>
          </DialogContent>
        </Dialog>
      </div>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.pointerDown(overlay!)

    expect(handleAncestorPointerDown).not.toHaveBeenCalled()
  })

  it('lets pointerdown events outside a dialog reach React ancestors', () => {
    const handleAncestorPointerDown = vi.fn()

    render(
      <div onPointerDown={handleAncestorPointerDown}>
        <button type="button">Outside</button>
      </div>
    )

    fireEvent.pointerDown(screen.getByText('Outside'))

    expect(handleAncestorPointerDown).toHaveBeenCalledTimes(1)
  })

  it('preserves pointerdown handlers inside the dialog content', () => {
    const handleAncestorPointerDown = vi.fn()
    const handleContentPointerDown = vi.fn()
    const handleButtonPointerDown = vi.fn()

    render(
      <div onPointerDown={handleAncestorPointerDown}>
        <Dialog open>
          <DialogContent aria-describedby={undefined} onPointerDown={handleContentPointerDown}>
            <DialogTitle>Rename item</DialogTitle>
            <button type="button" onPointerDown={handleButtonPointerDown}>
              Inside
            </button>
          </DialogContent>
        </Dialog>
      </div>
    )

    fireEvent.pointerDown(screen.getByText('Inside'))

    expect(handleButtonPointerDown).toHaveBeenCalledTimes(1)
    expect(handleContentPointerDown).toHaveBeenCalledTimes(1)
    expect(handleAncestorPointerDown).not.toHaveBeenCalled()
  })

  it('does not close on overlay click by default', () => {
    const handleOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(handleOpenChange).not.toHaveBeenCalled()
  })

  it('closes when overlay click close is explicitly enabled', () => {
    const handleOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} closeOnOverlayClick>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not close when overlay click close is disabled', () => {
    const handleOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} closeOnOverlayClick={false}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(handleOpenChange).not.toHaveBeenCalled()
  })
})
