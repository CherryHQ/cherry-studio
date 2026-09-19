import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SendMessageButton from '../SendMessageButton'

describe('SendMessageButton', () => {
  it('submits without moving pointer focus out of the input', async () => {
    const user = userEvent.setup()
    const sendMessage = vi.fn()
    render(
      <>
        <textarea aria-label="Message" />
        <SendMessageButton disabled={false} sendMessage={sendMessage} />
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
    render(<SendMessageButton disabled={false} sendMessage={sendMessage} />)
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
        <SendMessageButton disabled sendMessage={sendMessage} onDisabledClick={onDisabledClick} />
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
