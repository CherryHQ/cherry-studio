// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { PageSidePanel, PageSidePanelItem, PageSidePanelSection } from '../index'

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

    it('uses the same backdrop scrim as the dialog', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      const backdrop = document.querySelector('[data-slot="page-side-panel-backdrop"]')!
      expect(backdrop).toHaveClass('bg-black/50')
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
    it('renders header content', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} header={<span>My Header</span>} />)
      expect(screen.getByText('My Header')).toBeInTheDocument()
    })

    it('renders a standard title with the shared title class', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} title="My Title" />)
      expect(screen.getByText('My Title')).toHaveClass('font-semibold', 'text-base', 'text-foreground')
    })

    it('renders children in body', () => {
      render(
        <PageSidePanel open={true} onClose={vi.fn()}>
          <p>Body content</p>
        </PageSidePanel>
      )
      expect(screen.getByText('Body content')).toBeInTheDocument()
    })

    it('renders footer when provided', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} footer={<button type="button">Save</button>} />)
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(document.querySelector('[data-slot="page-side-panel-footer"]')).toBeInTheDocument()
    })

    it('does not render footer slot when not provided', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      expect(document.querySelector('[data-slot="page-side-panel-footer"]')).not.toBeInTheDocument()
    })

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
    it('uses the design shell classes by default', () => {
      render(
        <PageSidePanel open={true} onClose={vi.fn()} header={<span>Panel title</span>}>
          Body content
        </PageSidePanel>
      )
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('w-100')
      expect(dialog.className).toContain('rounded-3xl')
      expect(dialog.className).toContain('bg-card')
      expect(dialog.className).toContain('text-card-foreground')
      expect(dialog.className).toContain('shadow-xl')

      const header = document.querySelector('[data-slot="page-side-panel-header"]')!
      expect(header.className).toContain('px-6')
      expect(header.className).toContain('pt-6')
      expect(header.className).toContain('pb-3')

      const body = document.querySelector('[data-slot="page-side-panel-body"]')!
      expect(body.className).toContain('px-6')
      expect(body.className).toContain('py-4')
    })

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

    it('uses fixed positioning when portaled to document.body', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)

      expect(document.querySelector('[data-slot="page-side-panel-backdrop"]')).toHaveClass('fixed')
      expect(screen.getByRole('dialog')).toHaveClass('fixed')
    })

    it('portals into a scoped page side panel root when present', () => {
      const { container } = render(
        <div data-testid="page-shell">
          <div data-page-side-panel-root="true" data-testid="panel-root" />
          <PageSidePanel open={true} onClose={vi.fn()} />
        </div>
      )

      const root = screen.getByTestId('panel-root')
      const panel = root.querySelector('[data-slot="page-side-panel"]')
      const backdrop = root.querySelector('[data-slot="page-side-panel-backdrop"]')
      expect(container).toContainElement(root)
      expect(panel).toBeInTheDocument()
      expect(backdrop).toBeInTheDocument()
      expect(panel?.parentElement).toBe(root)
      expect(backdrop?.parentElement).toBe(root)
    })

    it('uses absolute positioning when portaled into a scoped root', () => {
      render(
        <div data-page-side-panel-root="true">
          <PageSidePanel open={true} onClose={vi.fn()} />
        </div>
      )

      expect(document.querySelector('[data-slot="page-side-panel-backdrop"]')).toHaveClass('absolute')
      expect(screen.getByRole('dialog')).toHaveClass('absolute')
    })

    it('applies design inset classes by default', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('top-3')
      expect(dialog.className).toContain('bottom-3')
      expect(dialog.className).toContain('right-3')
    })

    it('applies left-3 class when side=left', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} side="left" />)
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('left-3')
    })
  })

  describe('settings content helpers', () => {
    it('renders grouped sections with optional actions', () => {
      render(
        <PageSidePanelSection title="Display management" actions={<button type="button">Reset</button>}>
          <div>Panel content</div>
        </PageSidePanelSection>
      )

      expect(screen.getByText('Display management')).toHaveClass('font-semibold', 'text-sm')
      expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
      expect(screen.getByText('Panel content')).toBeInTheDocument()
    })

    it('renders preference rows with title, description, action, and body control', () => {
      render(
        <PageSidePanelItem
          title="Open links externally"
          description="Use the default browser"
          action={<button type="button">Toggle</button>}>
          <div>Extra control</div>
        </PageSidePanelItem>
      )

      expect(screen.getByText('Open links externally')).toHaveClass('text-sm')
      expect(screen.getByText('Use the default browser')).toHaveClass('text-xs')
      expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument()
      expect(screen.getByText('Extra control')).toBeInTheDocument()
    })
  })
})
