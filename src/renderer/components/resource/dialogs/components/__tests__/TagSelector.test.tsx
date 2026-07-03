// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { createContext, use } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'library.config.basic.tags': 'Tags',
        'library.config.basic.tag_empty': 'No tags available',
        'library.config.basic.tag_placeholder': 'Select tag',
        'common.clear': 'Clear'
      })[key] ?? key
  })
}))

type SelectContextValue = {
  open: boolean
  onOpenChange?: (open: boolean) => void
}

const SelectContext = createContext<SelectContextValue>({ open: false })

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Select: ({
    children,
    open = false,
    onOpenChange
  }: {
    children?: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <SelectContext value={{ open, onOpenChange }}>
      <div data-testid="select-root" data-open={String(open)}>
        {children}
      </div>
    </SelectContext>
  ),
  SelectContent: ({
    children,
    portalContainer,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode; portalContainer?: HTMLElement | null }) => {
    const { open } = use(SelectContext)
    return open ? createPortal(<div {...props}>{children}</div>, portalContainer ?? document.body) : null
  },
  SelectItem: ({ children }: { children?: ReactNode }) => <div role="option">{children}</div>,
  SelectTrigger: ({ children, ...props }: { children?: ReactNode }) => {
    const { open, onOpenChange } = use(SelectContext)
    return (
      <button type="button" {...props} onClick={() => onOpenChange?.(!open)}>
        {children}
      </button>
    )
  },
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}))

import { TagSelector } from '../TagSelector'

describe('TagSelector', () => {
  function createPortalContainer() {
    const portalContainer = document.createElement('div')
    document.body.append(portalContainer)
    vi.spyOn(portalContainer, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 240,
      width: 320,
      height: 240,
      toJSON: () => ({})
    })

    return portalContainer
  }

  it('shows an empty state and does not open the select when no tags are available', () => {
    const portalContainer = createPortalContainer()

    try {
      render(<TagSelector value={null} onChange={vi.fn()} allTagNames={[]} portalContainer={portalContainer} />)

      const trigger = screen.getByRole('button', { name: 'Tags' })

      expect(trigger).toHaveTextContent('No tags available')

      fireEvent.click(trigger)

      expect(document.querySelector('[data-tag-selector-content]')).not.toBeInTheDocument()
    } finally {
      portalContainer.remove()
    }
  })

  it('keeps the open select interactive when its content is portaled into the dialog', () => {
    const portalContainer = createPortalContainer()

    try {
      render(<TagSelector value={null} onChange={vi.fn()} allTagNames={['work']} portalContainer={portalContainer} />)

      fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
      const option = screen.getByRole('option', { name: 'work' })

      fireEvent.pointerDown(option, { clientX: 120, clientY: 80 })

      expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()
    } finally {
      portalContainer.remove()
    }
  })

  it('closes the open select and shields the parent dialog when the next click lands inside the dialog', () => {
    const portalContainer = createPortalContainer()
    const overlayTarget = document.createElement('div')
    document.body.append(overlayTarget)

    try {
      render(<TagSelector value={null} onChange={vi.fn()} allTagNames={['work']} portalContainer={portalContainer} />)

      fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()

      const pointerDown = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80
      })
      void act(() => overlayTarget.dispatchEvent(pointerDown))

      expect(pointerDown.defaultPrevented).toBe(true)
      expect(screen.queryByRole('option', { name: 'work' })).not.toBeInTheDocument()

      const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 })
      overlayTarget.dispatchEvent(click)

      expect(click.defaultPrevented).toBe(true)
    } finally {
      portalContainer.remove()
      overlayTarget.remove()
    }
  })

  it('releases the dialog click shield when a pointer sequence is cancelled before click', () => {
    const portalContainer = createPortalContainer()
    const overlayTarget = document.createElement('div')
    const dialogTarget = document.createElement('button')
    portalContainer.append(dialogTarget)
    document.body.append(overlayTarget)

    try {
      render(<TagSelector value={null} onChange={vi.fn()} allTagNames={['work']} portalContainer={portalContainer} />)

      fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()

      const pointerDown = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80
      })
      void act(() => overlayTarget.dispatchEvent(pointerDown))

      const pointerCancel = new MouseEvent('pointercancel', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80
      })
      overlayTarget.dispatchEvent(pointerCancel)

      const laterClick = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 })
      dialogTarget.dispatchEvent(laterClick)

      expect(laterClick.defaultPrevented).toBe(false)
    } finally {
      portalContainer.remove()
      overlayTarget.remove()
    }
  })
})
