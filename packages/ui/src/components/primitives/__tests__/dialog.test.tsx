// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '../../../utils'
import { Dialog, DIALOG_CLOSE_DURATION_MS, DialogContent, DialogTitle } from '../dialog'
import { DialogPortalContainerProvider } from '../portal-container'
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
  vi.restoreAllMocks()
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
  it('keeps nested dialogs in the page dialog portal instead of the parent dialog content', () => {
    const pagePortalContainer = document.createElement('div')
    document.body.appendChild(pagePortalContainer)

    render(
      <DialogPortalContainerProvider container={pagePortalContainer}>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Outer dialog</DialogTitle>
            <Dialog open>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>Inner dialog</DialogTitle>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </DialogPortalContainerProvider>
    )

    const outerContent = screen.getByText('Outer dialog').closest('[data-slot="dialog-content"]')
    const innerContent = screen.getByText('Inner dialog').closest('[data-slot="dialog-content"]')

    expect(outerContent?.parentElement).toBe(pagePortalContainer)
    expect(innerContent?.parentElement).toBe(pagePortalContainer)
    expect(innerContent?.parentElement).not.toBe(outerContent)

    pagePortalContainer.remove()
  })

  it('keeps the declared close and imperative-unmount durations synchronized', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).not.toBeNull()
    expect(content?.className).toContain(`data-[state=closed]:animation-duration-[${DIALOG_CLOSE_DURATION_MS}ms]`)
    expect(DIALOG_CLOSE_DURATION_MS).toBe(200)
    expect(DIALOG_UNMOUNT_DELAY_MS).toBe(DIALOG_CLOSE_DURATION_MS)
  })

  it('uses asymmetric directional motion and disables it when reduced motion is requested', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    const content = document.querySelector('[data-slot="dialog-content"]')

    expect(overlay).toHaveClass(
      'data-[state=open]:animation-duration-[220ms]',
      'data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]',
      'data-[state=closed]:animation-duration-[200ms]',
      'data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)]',
      'motion-reduce:animate-none'
    )
    expect(content).toHaveClass(
      'data-[state=open]:animation-duration-[260ms]',
      'data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]',
      'data-[state=open]:zoom-in-99',
      'data-[state=open]:slide-in-from-bottom-4',
      'data-[state=closed]:animation-duration-[200ms]',
      'data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)]',
      'data-[state=closed]:zoom-out-99',
      'data-[state=closed]:slide-out-to-bottom-4',
      'motion-reduce:animate-none'
    )
  })

  it('supports fade-scale motion without directional translation for alerts and confirmations', () => {
    render(
      <Dialog open>
        <DialogContent motion="fade-scale" aria-describedby={undefined}>
          <DialogTitle>Confirm action</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const content = document.querySelector('[data-slot="dialog-content"]')

    expect(content).toHaveClass(
      'data-[state=open]:fade-in-0',
      'data-[state=open]:zoom-in-99',
      'data-[state=closed]:fade-out-0',
      'data-[state=closed]:zoom-out-99'
    )
    expect(content).not.toHaveClass(
      'data-[state=open]:slide-in-from-bottom-4',
      'data-[state=closed]:slide-out-to-bottom-4'
    )
  })

  it('marks dialog content as no-drag so it stays clickable over titlebar drag regions', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).toHaveClass('[-webkit-app-region:no-drag]')
  })

  it('keeps content mounted while its close animation is active', () => {
    const originalGetComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const styles = originalGetComputedStyle(element)
      return new Proxy(styles, {
        get(target, property, receiver) {
          if (property === 'animationName') {
            return element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter'
          }
          if (property === 'display') return 'grid'
          return Reflect.get(target, property, receiver)
        }
      })
    })

    const { rerender } = render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Animated dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const content = screen.getByText('Animated dialog').closest('[data-slot="dialog-content"]')
    expect(content).toBeInTheDocument()

    rerender(
      <Dialog open={false}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Animated dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(content).toBeInTheDocument()
    expect(content).toHaveAttribute('data-state', 'closed')
  })

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

  it('keeps the overlay mounted when overlay click close is toggled', () => {
    const handleOpenChange = vi.fn()
    const { rerender } = render(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} closeOnOverlayClick>
          <DialogTitle>Create item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    rerender(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} closeOnOverlayClick={false}>
          <DialogTitle>Create item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(overlay)
    fireEvent.click(overlay!)
    expect(handleOpenChange).not.toHaveBeenCalled()

    rerender(
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} closeOnOverlayClick>
          <DialogTitle>Create item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(overlay)
    fireEvent.click(overlay!)
    expect(handleOpenChange).toHaveBeenCalledWith(false)
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

  it('names the close control Close by default', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename item</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('uses a caller-provided closeLabel as the close control name', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined} closeLabel="关闭">
          <DialogTitle>频道日志</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})
