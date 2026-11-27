// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { PortalContainerProvider } from '@cherrystudio/ui/components/primitives/portal-container'

import { PageSidePanel } from '../index'

const motionSnapshots = vi.hoisted(() => ({
  propsBySlot: new Map<string, Record<string, unknown>>()
}))

vi.mock('motion/react', async () => {
  const ReactActual = await vi.importActual<typeof React>('react')
  const motionPropNames = new Set(['initial', 'animate', 'exit', 'transition'])
  const createMotionComponent =
    (tag: 'div' | 'aside') =>
    ({
      ref,
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode } & { ref?: React.RefObject<HTMLElement | null> }) => {
      if (typeof props['data-slot'] === 'string') {
        motionSnapshots.propsBySlot.set(props['data-slot'], props)
      }

      const domProps = Object.fromEntries(Object.entries(props).filter(([key]) => !motionPropNames.has(key)))
      return ReactActual.createElement(tag, { ...domProps, ref }, children)
    }

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    motion: {
      aside: createMotionComponent('aside'),
      div: createMotionComponent('div')
    }
  }
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  motionSnapshots.propsBySlot.clear()
})

describe('PageSidePanel', () => {
  describe('open / close', () => {
    it('renders nothing when closed', () => {
      render(<PageSidePanel open={false} onClose={vi.fn()} />)
      expect(document.querySelector('[data-slot="page-side-panel"]')).not.toBeInTheDocument()
    })

    it('renders panel when open', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      const backdrop = document.querySelector('[data-slot="page-side-panel-backdrop"]')!
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      const closeBtn = screen.getByLabelText('Close')
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose on close button pointer down to avoid click-through during exit', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      fireEvent.pointerDown(screen.getByLabelText('Close'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose twice for one pointerdown+click sequence', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      const closeBtn = screen.getByLabelText('Close')
      fireEvent.pointerDown(closeBtn)
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('renders the close button as a non-submit button', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      expect(screen.getByLabelText('Close')).toHaveAttribute('type', 'button')
    })
  })

  describe('accessibility', () => {
    it('has role=dialog and aria-modal=true', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('uses the header as the dialog accessible name', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} header={<span>Panel title</span>} />)
      expect(screen.getByRole('dialog', { name: 'Panel title' })).toBeInTheDocument()
    })

    it('uses the standard title as the dialog accessible name', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} title="Panel title" />)
      expect(screen.getByRole('dialog', { name: 'Panel title' })).toBeInTheDocument()
    })

    it('restores focus to the trigger when closed', () => {
      function TestPanel() {
        const [open, setOpen] = React.useState(false)
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Open panel
            </button>
            <PageSidePanel open={open} onClose={() => setOpen(false)} header={<span>Panel title</span>} />
          </>
        )
      }

      render(<TestPanel />)
      const trigger = screen.getByRole('button', { name: 'Open panel' })
      trigger.focus()
      fireEvent.click(trigger)

      fireEvent.click(screen.getByLabelText('Close'))

      expect(trigger).toHaveFocus()
    })

    it('calls onClose on Escape key', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose on other keys', () => {
      const onClose = vi.fn()
      render(<PageSidePanel open={true} onClose={onClose} />)
      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Enter' })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('content slots', () => {
    it('hides close button when showCloseButton=false and no header', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} showCloseButton={false} />)
      expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
    })

    it('uses custom closeLabel for aria-label', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} closeLabel="Dismiss" />)
      expect(screen.getByLabelText('Dismiss')).toBeInTheDocument()
    })
  })

  describe('placement', () => {
    function ScopedPanel() {
      const [container, setContainer] = React.useState<HTMLDivElement | null>(null)

      return (
        <div data-testid="page-shell">
          <div ref={setContainer} data-testid="panel-root">
            <PortalContainerProvider container={container}>
              <PageSidePanel open={true} onClose={vi.fn()} />
            </PortalContainerProvider>
          </div>
        </div>
      )
    }

    it('portals the backdrop and panel to document.body', () => {
      const { container } = render(
        <div data-testid="page-shell">
          <PageSidePanel open={true} onClose={vi.fn()} />
        </div>
      )

      expect(container.querySelector('[data-slot="page-side-panel"]')).not.toBeInTheDocument()
      expect(document.body.querySelector('[data-slot="page-side-panel"]')).toBeInTheDocument()
      expect(document.body.querySelector('[data-slot="page-side-panel-backdrop"]')).toBeInTheDocument()
    })

    it('portals into a provided page side panel container', async () => {
      const { container } = render(<ScopedPanel />)

      const root = screen.getByTestId('panel-root')
      await waitFor(() => expect(root.querySelector('[data-slot="page-side-panel"]')).toBeInTheDocument())
      const panel = root.querySelector('[data-slot="page-side-panel"]')
      const backdrop = root.querySelector('[data-slot="page-side-panel-backdrop"]')
      expect(container).toContainElement(root)
      expect(panel).toBeInTheDocument()
      expect(backdrop).toBeInTheDocument()
      expect(panel?.parentElement).toBe(root)
      expect(backdrop?.parentElement).toBe(root)
    })
  })
})
