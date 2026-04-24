// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { PageSidePanel } from '../index'

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
      const { container } = render(<PageSidePanel open={false} onClose={vi.fn()} />)
      expect(container.querySelector('[data-slot="page-side-panel"]')).not.toBeInTheDocument()
    })

    it('renders panel when open', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn()
      const { container } = render(<PageSidePanel open={true} onClose={onClose} />)
      const backdrop = container.querySelector('[data-slot="page-side-panel-backdrop"]')!
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
  })

  describe('accessibility', () => {
    it('has role=dialog and aria-modal=true', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
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

    it('renders children in body', () => {
      render(
        <PageSidePanel open={true} onClose={vi.fn()}>
          <p>Body content</p>
        </PageSidePanel>
      )
      expect(screen.getByText('Body content')).toBeInTheDocument()
    })

    it('renders footer when provided', () => {
      const { container } = render(
        <PageSidePanel open={true} onClose={vi.fn()} footer={<button type="button">Save</button>} />
      )
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(container.querySelector('[data-slot="page-side-panel-footer"]')).toBeInTheDocument()
    })

    it('does not render footer slot when not provided', () => {
      const { container } = render(<PageSidePanel open={true} onClose={vi.fn()} />)
      expect(container.querySelector('[data-slot="page-side-panel-footer"]')).not.toBeInTheDocument()
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
    it('applies right-2 class by default', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('right-2')
    })

    it('applies left-2 class when side=left', () => {
      render(<PageSidePanel open={true} onClose={vi.fn()} side="left" />)
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('left-2')
    })
  })
})
