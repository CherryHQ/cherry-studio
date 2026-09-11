import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Reproduces Radix's trigger contract: with `asChild` the child element *is* the trigger and
// carries the trigger props (aria-describedby and the hover/focus handlers); without it the
// library wraps the child in a div of its own, which is what the tooltip then describes.
vi.mock('@cherrystudio/ui', () => ({
  Kbd: ({ children, className, ...props }: ComponentProps<'kbd'>) => (
    <kbd data-slot="kbd" className={className} {...props}>
      {children}
    </kbd>
  ),
  Tooltip: ({ children, content, asChild }: { children: ReactNode; content: ReactNode; asChild?: boolean }) => (
    <>
      {createPortal(<span data-testid="tooltip-content">{content}</span>, document.body)}
      {asChild && React.isValidElement(children)
        ? // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild trigger props
          React.cloneElement(children, {
            'aria-describedby': 'tooltip-content',
            'data-tooltip-trigger': 'true'
          } as Record<string, unknown>)
        : children}
    </>
  )
}))

import SendMessageButton from '../SendMessageButton'

describe('SendMessageButton', () => {
  afterEach(cleanup)

  it('describes the send control itself with the send shortcut', () => {
    render(<SendMessageButton disabled={false} sendMessage={vi.fn()} shortcutLabel="Ctrl+Enter" />)

    // The control keeps its own accessible name while the tooltip attaches to it.
    const send = screen.getByRole('button', { name: 'chat.input.send' })
    expect(send).toHaveAttribute('data-tooltip-trigger', 'true')
    expect(send).toHaveAttribute('aria-describedby', 'tooltip-content')

    // Label and keycap are separate nodes: the keycap is aria-hidden and the wording around it
    // comes from the locale catalog rather than being assembled in the component.
    const content = screen.getByTestId('tooltip-content')
    expect(content).toHaveTextContent('chat.input.send')
    expect(content.querySelector('[data-slot="kbd"]')).toHaveTextContent('Ctrl+Enter')
  })

  it('renders the bare control when the shortcut is unavailable', () => {
    render(<SendMessageButton disabled={false} sendMessage={vi.fn()} />)

    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat.input.send' })).not.toHaveAttribute('data-tooltip-trigger')
  })

  it('still sends on click and reports a blocked send when disabled', () => {
    const sendMessage = vi.fn()
    const onDisabledClick = vi.fn()
    const { unmount } = render(
      <SendMessageButton disabled={false} sendMessage={sendMessage} onDisabledClick={onDisabledClick} />
    )

    screen.getByRole('button', { name: 'chat.input.send' }).click()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(onDisabledClick).not.toHaveBeenCalled()

    unmount()
    render(<SendMessageButton disabled sendMessage={sendMessage} onDisabledClick={onDisabledClick} />)

    screen.getByRole('button', { name: 'chat.input.send' }).click()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(onDisabledClick).toHaveBeenCalledOnce()
  })
})
