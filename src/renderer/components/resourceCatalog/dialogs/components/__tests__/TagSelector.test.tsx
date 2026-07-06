// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
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

      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    } finally {
      portalContainer.remove()
    }
  })

  it('closes the open select when it loses all tag options', () => {
    const portalContainer = createPortalContainer()

    try {
      const { rerender } = render(
        <TagSelector value={null} onChange={vi.fn()} allTagNames={['work']} portalContainer={portalContainer} />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()

      rerender(<TagSelector value={null} onChange={vi.fn()} allTagNames={[]} portalContainer={portalContainer} />)
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    } finally {
      portalContainer.remove()
    }
  })
})
