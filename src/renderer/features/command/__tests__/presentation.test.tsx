import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preferenceValues } = vi.hoisted(() => ({
  preferenceValues: {} as Record<string, unknown>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: true,
  platform: 'darwin'
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [preferenceValues[key], vi.fn()],
  useMultiplePreferences: () => [preferenceValues, vi.fn()]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Kbd: ({ children, className, ...props }: ComponentProps<'kbd'>) => (
    <kbd data-slot="kbd" className={className} {...props}>
      {children}
    </kbd>
  ),
  Tooltip: ({
    children,
    content,
    delay,
    placement
  }: {
    children: ReactNode
    content: ReactNode
    delay?: number
    placement?: string
  }) => (
    <div data-delay={delay} data-placement={placement}>
      <div data-testid="tooltip-content">{content}</div>
      {children}
    </div>
  )
}))

import { ContextKeyProvider } from '../ContextKeyProvider'
import * as commandExports from '../index'
import { CommandShortcut, CommandTooltip } from '../presentation'

function renderShortcut() {
  return render(
    <ContextKeyProvider>
      <CommandShortcut command="topic.create" />
    </ContextKeyProvider>
  )
}

describe('CommandShortcut', () => {
  beforeEach(() => {
    for (const key of Object.keys(preferenceValues)) {
      delete preferenceValues[key]
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders command shortcut labels through the Kbd primitive', () => {
    renderShortcut()

    const shortcut = screen.getByText('⌘N')

    expect(shortcut.tagName).toBe('KBD')
    expect(shortcut.getAttribute('data-slot')).toBe('kbd')
    expect(shortcut.className).toContain('rounded-full')
    expect(shortcut.className).not.toContain('font-mono')
  })

  it('does not render when the shortcut has been cleared', () => {
    preferenceValues['shortcut.topic.create'] = { binding: [], enabled: true }

    renderShortcut()

    expect(screen.queryByText('⌘N')).toBeNull()
  })

  it('supports context-specific tooltip labels while keeping command shortcut rendering centralized', () => {
    render(
      <ContextKeyProvider>
        <CommandTooltip command="topic.create" label="New Session" placement="bottom" delay={800}>
          <button type="button">trigger</button>
        </CommandTooltip>
      </ContextKeyProvider>
    )

    const content = screen.getByTestId('tooltip-content')

    expect(content).toHaveTextContent('New Session')
    expect(content.parentElement).toHaveAttribute('data-placement', 'bottom')
    expect(content.parentElement).toHaveAttribute('data-delay', '800')
    expect(screen.getByText('⌘N').tagName).toBe('KBD')
    expect(screen.getByText('⌘N').className).toContain('bg-transparent')
    expect(screen.getByText('⌘N').className).toContain('rounded-none')
    expect(screen.getByText('⌘N').className).toContain('[font:inherit]')
  })

  it('does not expose the low-level shortcut label hook from the commands barrel', () => {
    expect('useCommandShortcutLabel' in commandExports).toBe(false)
  })
})
