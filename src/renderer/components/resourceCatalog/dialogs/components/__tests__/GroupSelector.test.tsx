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
        'library.config.basic.group': 'Group',
        'library.config.basic.group_empty': 'No groups available',
        'library.config.basic.group_placeholder': 'Select group',
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

import { GroupSelector } from '../GroupSelector'

describe('GroupSelector', () => {
  const groups = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      entityType: 'assistant' as const,
      name: 'work',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  ]

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
      render(<GroupSelector value={null} onChange={vi.fn()} groups={[]} portalContainer={portalContainer} />)

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
        <GroupSelector value={null} onChange={vi.fn()} groups={groups} portalContainer={portalContainer} />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()

      rerender(<GroupSelector value={null} onChange={vi.fn()} groups={[]} portalContainer={portalContainer} />)
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    } finally {
      portalContainer.remove()
    }
  })
})
