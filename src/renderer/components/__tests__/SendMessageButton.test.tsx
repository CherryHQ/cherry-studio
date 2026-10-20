import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// The shortcut tooltip is this button's accessibility contract, so it runs against the real
// `@cherrystudio/ui` primitives; the shared renderer mock's Tooltip never opens a content node.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  const [tooltip, kbd] = await Promise.all([
    import('@cherrystudio/ui/components/primitives/tooltip'),
    import('@cherrystudio/ui/components/primitives/kbd')
  ])
  return { ...actual, ...tooltip, ...kbd }
})

import SendMessageButton from '../SendMessageButton'

/** Long enough for a real tooltip to have opened, short enough to keep the suite fast. */
const TOOLTIP_SETTLE_MS = 300

describe('SendMessageButton', () => {
  afterEach(cleanup)

  it('announces the send shortcut to keyboard and screen-reader users', async () => {
    const user = userEvent.setup()
    render(<SendMessageButton disabled={false} sendMessage={vi.fn()} shortcutLabel="Ctrl+Enter" />)
    const send = screen.getByRole('button', { name: 'chat.input.send' })

    // The send control must be the trigger itself: the default wrapper owns the focus handlers and
    // would keep the shortcut away from everyone not using a mouse.
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).toBe(send)

    await user.tab()
    expect(send).toHaveFocus()

    const description = await waitFor(() => {
      const id = send.getAttribute('aria-describedby')
      expect(id).toBeTruthy()
      return document.getElementById(id as string)
    })
    expect(description).toHaveAttribute('role', 'tooltip')
    expect(description).toHaveTextContent('chat.input.send')
    // The keycap is aria-hidden, so the sr-only copy is what the description announces.
    expect(description).toHaveTextContent('Ctrl+Enter')
  })

  it('does not advertise a send shortcut while sending is blocked', async () => {
    const user = userEvent.setup()
    render(<SendMessageButton disabled sendMessage={vi.fn()} shortcutLabel="Ctrl+Enter" />)
    const send = screen.getByRole('button', { name: 'chat.input.send' })

    // Disabled leaves the control out of the tooltip tree, so no hover can produce a description.
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).toBeNull()

    await user.hover(send)
    await new Promise((resolve) => setTimeout(resolve, TOOLTIP_SETTLE_MS))

    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull()
    expect(send).not.toHaveAttribute('aria-describedby')
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

  it('submits without moving pointer focus out of the input', async () => {
    const user = userEvent.setup()
    const sendMessage = vi.fn()
    render(
      <>
        <textarea aria-label="Message" />
        <SendMessageButton disabled={false} sendMessage={sendMessage} shortcutLabel="Ctrl+Enter" />
      </>
    )
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.click(screen.getByRole('button'))
    expect(input).toHaveFocus()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it.each(['{Enter}', ' '])('supports keyboard submission with %s', async (key) => {
    const user = userEvent.setup()
    const sendMessage = vi.fn()
    render(<SendMessageButton disabled={false} sendMessage={sendMessage} shortcutLabel="Ctrl+Enter" />)
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await user.keyboard(key)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps focus and reports blocked pointer submissions without sending', async () => {
    const user = userEvent.setup()
    const sendMessage = vi.fn()
    const onDisabledClick = vi.fn()
    render(
      <>
        <textarea aria-label="Message" />
        <SendMessageButton
          disabled
          sendMessage={sendMessage}
          onDisabledClick={onDisabledClick}
          shortcutLabel="Ctrl+Enter"
        />
      </>
    )
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.click(screen.getByRole('button'))
    expect(input).toHaveFocus()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onDisabledClick).toHaveBeenCalledTimes(1)
  })
})
