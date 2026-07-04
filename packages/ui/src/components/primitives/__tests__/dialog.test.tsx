// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from '../dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  cleanup()
})
function DialogWithSelect({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [selectOpen, setSelectOpen] = useState(false)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Configure item</DialogTitle>
        <input aria-label="Name" />
        <Select open={selectOpen} value="alpha" onOpenChange={setSelectOpen}>
          <SelectTrigger aria-label="Mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alpha">Alpha</SelectItem>
            <SelectItem value="beta">Beta</SelectItem>
          </SelectContent>
        </Select>
      </DialogContent>
    </Dialog>
  )
}

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

  it('closes on overlay click by default', () => {
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
  it('keeps the dialog open when dismissing an in-dialog select from another dialog field', async () => {
    const handleOpenChange = vi.fn()

    render(<DialogWithSelect onOpenChange={handleOpenChange} />)

    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Mode' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Mode' }))

    expect(await screen.findByRole('option', { name: 'Beta' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('dialog')).not.toHaveStyle({ pointerEvents: 'none' }))

    fireEvent.pointerDown(screen.getByLabelText('Name'))
    fireEvent.click(screen.getByLabelText('Name'))

    await waitFor(() => expect(screen.queryByRole('option', { name: 'Beta' })).not.toBeInTheDocument())
    expect(handleOpenChange).not.toHaveBeenCalledWith(false)
  })
})
