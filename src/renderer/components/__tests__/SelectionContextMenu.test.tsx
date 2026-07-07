import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionContextMenu from '../SelectionContextMenu'

type ExtraItem = {
  id: string
  label: string
  onSelect?: () => void
  type: 'item' | 'separator' | 'submenu'
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'common.copy') return 'Copy'
      if (key === 'chat.message.quote') return 'Quote'
      return key
    }
  })
}))

vi.mock('@renderer/components/command', async () => {
  const React = await import('react')

  return {
    CommandContextMenu: ({
      children,
      extraItems = [],
      getExtraItems,
      onOpenChange
    }: {
      children: ReactNode
      extraItems?: readonly ExtraItem[]
      getExtraItems?: (event: React.MouseEvent) => readonly ExtraItem[] | PromiseLike<readonly ExtraItem[]>
      onOpenChange?: (open: boolean) => void
    }) => {
      const [items, setItems] = React.useState<readonly ExtraItem[]>(extraItems)

      React.useEffect(() => {
        setItems(extraItems)
      }, [extraItems])

      const handleContextMenu = (event: React.MouseEvent) => {
        event.preventDefault()
        onOpenChange?.(true)
        const resolvedItems = getExtraItems?.(event)
        if (resolvedItems && 'then' in resolvedItems) {
          void resolvedItems.then(setItems)
          return
        }
        setItems(resolvedItems ?? extraItems)
      }

      return (
        <div onContextMenu={handleContextMenu}>
          {children}
          <div data-testid="menu-items">
            {items
              .filter((item) => item.type === 'item')
              .map((item) => (
                <button key={item.id} type="button" onClick={item.onSelect}>
                  {item.label}
                </button>
              ))}
          </div>
        </div>
      )
    }
  }
})

function mockSelection(text: string) {
  const selection = {
    getRangeAt: () => ({
      cloneContents: () => document.createDocumentFragment()
    }),
    isCollapsed: text.length === 0,
    rangeCount: text.length > 0 ? 1 : 0,
    toString: () => text
  } as unknown as Selection

  vi.spyOn(window, 'getSelection').mockReturnValue(selection)
}

describe('SelectionContextMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(window as any).api = { quoteToMainWindow: vi.fn() }
    ;(window as any).toast = {
      error: vi.fn(),
      success: vi.fn()
    }
    mockSelection('')
  })

  it('does not show selection actions when no text is selected', () => {
    render(
      <SelectionContextMenu>
        <div data-testid="target">message</div>
      </SelectionContextMenu>
    )

    fireEvent.contextMenu(screen.getByTestId('target'))

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quote' })).not.toBeInTheDocument()
  })

  it('shows selection actions when text is selected', () => {
    mockSelection('selected text')

    render(
      <SelectionContextMenu>
        <div data-testid="target">message</div>
      </SelectionContextMenu>
    )

    fireEvent.contextMenu(screen.getByTestId('target'))

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quote' })).toBeInTheDocument()
  })
})
