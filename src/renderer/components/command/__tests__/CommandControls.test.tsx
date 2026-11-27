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

vi.mock('@renderer/utils/platform', () => ({
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

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandHint, CommandShortcut, CommandTooltip } from '../CommandControls'

function renderShortcut() {
  return render(
    <CommandContextKeyProvider>
      <CommandShortcut command="topic.create" />
    </CommandContextKeyProvider>
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

  it('does not render when the shortcut has been cleared', () => {
    preferenceValues['shortcut.topic.create'] = { binding: [], enabled: true }

    renderShortcut()

    expect(screen.queryByText('⌘N')).toBeNull()
  })

  it('supports context-specific tooltip labels while keeping command shortcut rendering centralized', () => {
    render(
      <CommandContextKeyProvider>
        <CommandTooltip command="topic.create" label="New Session" placement="bottom" delay={800}>
          <button type="button">trigger</button>
        </CommandTooltip>
      </CommandContextKeyProvider>
    )

    const content = screen.getByTestId('tooltip-content')

    expect(content).toHaveTextContent('New Session')
    expect(screen.getByText('⌘N', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('renders nothing when the command has no shortcut', () => {
    preferenceValues['shortcut.topic.create'] = { binding: [], enabled: true }

    const { container } = render(
      <CommandContextKeyProvider>
        <CommandHint command="topic.create" />
      </CommandContextKeyProvider>
    )

    expect(container).toBeEmptyDOMElement()
  })
})
