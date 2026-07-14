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
        event.stopPropagation()
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

function mockSelection(text: string, fragment?: DocumentFragment) {
  const hasSelection = text.length > 0 || !!fragment
  const selection = {
    getRangeAt: () => ({
      cloneContents: () =>
        (fragment?.cloneNode(true) as DocumentFragment | undefined) ?? document.createDocumentFragment()
    }),
    isCollapsed: !hasSelection,
    rangeCount: hasSelection ? 1 : 0,
    toString: () => text
  } as unknown as Selection

  vi.spyOn(window, 'getSelection').mockReturnValue(selection)
}

function createCodeSelectionFragment(lines: string[]) {
  const fragment = document.createDocumentFragment()

  lines.forEach((lineText, index) => {
    const line = document.createElement('div')
    line.className = 'line'

    const lineNumber = document.createElement('span')
    lineNumber.className = 'line-number'
    lineNumber.textContent = String(index + 1)
    line.append(lineNumber)

    const lineContent = document.createElement('span')
    lineContent.className = 'line-content'
    lineContent.append(document.createTextNode(lineText))
    line.append(lineContent)

    fragment.append(line)
  })

  return fragment
}

describe('SelectionContextMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
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

  it('preserves indentation when selected code includes line numbers', () => {
    mockSelection(
      '1    const value = 1\n2  return value',
      createCodeSelectionFragment(['    const value = 1', '  return value'])
    )

    render(
      <SelectionContextMenu>
        <div data-testid="target">message</div>
      </SelectionContextMenu>
    )

    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('    const value = 1\n  return value')
  })

  it('keeps whitespace-only code selections actionable', () => {
    mockSelection('1    ', createCodeSelectionFragment(['    ']))

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
