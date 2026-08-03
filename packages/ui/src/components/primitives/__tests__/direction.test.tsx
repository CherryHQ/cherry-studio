// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CommandShortcut } from '../command'
import { ContextMenuShortcut } from '../context-menu'
import { DirectionProvider, resolveInlineSide, useDirection } from '../direction'
import { DropdownMenuShortcut } from '../dropdown-menu'

afterEach(() => {
  cleanup()
})

function DirectionProbe() {
  const direction = useDirection()
  return <span data-testid="probe">{direction}</span>
}

describe('useDirection', () => {
  it('defaults to ltr when no provider is mounted', () => {
    render(<DirectionProbe />)

    expect(screen.getByTestId('probe')).toHaveTextContent('ltr')
  })

  it('reports the mounted direction', () => {
    render(
      <DirectionProvider dir="rtl">
        <DirectionProbe />
      </DirectionProvider>
    )

    expect(screen.getByTestId('probe')).toHaveTextContent('rtl')
  })
})

describe('resolveInlineSide', () => {
  it('maps logical sides onto physical ones per direction', () => {
    expect(resolveInlineSide('start', 'ltr')).toBe('left')
    expect(resolveInlineSide('end', 'ltr')).toBe('right')
    expect(resolveInlineSide('start', 'rtl')).toBe('right')
    expect(resolveInlineSide('end', 'rtl')).toBe('left')
  })
})

describe('keyboard shortcut direction', () => {
  const shortcutComponents = [
    { name: 'command', Component: CommandShortcut },
    { name: 'context menu', Component: ContextMenuShortcut },
    { name: 'dropdown menu', Component: DropdownMenuShortcut }
  ]

  it.each(shortcutComponents)('keeps $name alignment logical while isolating its text as LTR', ({ Component }) => {
    render(
      <div dir="rtl">
        <Component>⌘K</Component>
      </div>
    )

    const content = screen.getByText('⌘K')
    const shortcut = content.parentElement

    expect(shortcut).toHaveClass('ms-auto')
    expect(shortcut).not.toHaveAttribute('dir')
    expect(content).toHaveAttribute('dir', 'ltr')
  })
})
