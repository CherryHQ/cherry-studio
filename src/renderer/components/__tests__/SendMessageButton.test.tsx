import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const TOOLTIP_CONTENT_ID = 'mock-tooltip-content'

/** Radix `Slot` merges its trigger props into the child, composing handlers instead of replacing. */
function mergeTriggerProps(own: Record<string, unknown>, trigger: Record<string, unknown>) {
  const merged = { ...own, ...trigger }
  for (const [key, value] of Object.entries(trigger)) {
    const ownValue = own[key]
    if (typeof ownValue !== 'function' || typeof value !== 'function') continue
    merged[key] = (...args: unknown[]) => {
      ;(ownValue as (...args: unknown[]) => void)(...args)
      ;(value as (...args: unknown[]) => void)(...args)
    }
  }
  return merged
}

// Mirrors the primitive's trigger contract: with `asChild` the child element *is* the trigger and
// carries the composed props, without it the library wraps the child in a div of its own,
// `isDisabled` returns the bare child, and content is portalled only while open (Radix behavior).
vi.mock('@cherrystudio/ui', () => ({
  Kbd: ({ children, className, ...props }: ComponentProps<'kbd'>) => (
    <kbd data-slot="kbd" className={className} {...props}>
      {children}
    </kbd>
  ),
  Tooltip: ({
    children,
    content,
    asChild,
    isDisabled
  }: {
    children: ReactNode
    content: ReactNode
    asChild?: boolean
    isDisabled?: boolean
  }) => {
    const [open, setOpen] = useState(false)

    if (isDisabled) {
      return asChild && React.isValidElement(children) ? children : <div>{children}</div>
    }

    const triggerProps = {
      'aria-describedby': open ? TOOLTIP_CONTENT_ID : undefined,
      'data-tooltip-trigger': 'true',
      onPointerEnter: () => setOpen(true),
      onPointerLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false)
    }

    return (
      <>
        {asChild && React.isValidElement(children) ? (
          // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix's Slot merge
          React.cloneElement(children, mergeTriggerProps(children.props as Record<string, unknown>, triggerProps))
        ) : (
          <div {...triggerProps}>{children}</div>
        )}
        {open &&
          createPortal(
            <span id={TOOLTIP_CONTENT_ID} data-testid="tooltip-content">
              {content}
            </span>,
            document.body
          )}
      </>
    )
  }
}))

import SendMessageButton from '../SendMessageButton'

describe('SendMessageButton', () => {
  afterEach(cleanup)

  it('hangs the shortcut tooltip on the send control itself', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <SendMessageButton disabled={false} sendMessage={vi.fn()} shortcutLabel="Ctrl+Enter" />
    )
    const send = screen.getByRole('button', { name: 'chat.input.send' })

    // `asChild` leaves the control as the only element the tooltip owns; a wrapper would sit here.
    expect(container.firstElementChild).toBe(send)
    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()

    await user.hover(send)

    expect(send).toHaveAttribute('aria-describedby', TOOLTIP_CONTENT_ID)
    const content = await screen.findByTestId('tooltip-content')
    expect(content).toHaveTextContent('chat.input.send')
    expect(content.querySelector('[data-slot="kbd"]')).toHaveTextContent('Ctrl+Enter')
    // The keycap is aria-hidden, so the sr-only copy is what the description announces.
    expect(content.querySelector('.sr-only')).toHaveTextContent('Ctrl+Enter')
  })

  it('suppresses the tooltip while the send control is disabled', () => {
    const { container } = render(<SendMessageButton disabled sendMessage={vi.fn()} shortcutLabel="Ctrl+Enter" />)
    const send = screen.getByRole('button', { name: 'chat.input.send' })

    fireEvent.pointerEnter(send)

    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()
    expect(send).not.toHaveAttribute('data-tooltip-trigger')
    expect(container.firstElementChild).toBe(send)
  })

  it('still sends on click and reports a blocked send when disabled', () => {
    const sendMessage = vi.fn()
    const onDisabledClick = vi.fn()
    const { unmount } = render(
      <SendMessageButton
        disabled={false}
        sendMessage={sendMessage}
        onDisabledClick={onDisabledClick}
        shortcutLabel="Ctrl+Enter"
      />
    )

    screen.getByRole('button', { name: 'chat.input.send' }).click()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(onDisabledClick).not.toHaveBeenCalled()

    unmount()
    render(
      <SendMessageButton
        disabled
        sendMessage={sendMessage}
        onDisabledClick={onDisabledClick}
        shortcutLabel="Ctrl+Enter"
      />
    )

    screen.getByRole('button', { name: 'chat.input.send' }).click()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(onDisabledClick).toHaveBeenCalledOnce()
  })

  it('keeps the keyboard activation on the control the tooltip borrows', () => {
    const sendMessage = vi.fn()
    render(<SendMessageButton disabled={false} sendMessage={sendMessage} shortcutLabel="Ctrl+Enter" />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'chat.input.send' }), { key: 'Enter' })

    expect(sendMessage).toHaveBeenCalledOnce()
  })
})
