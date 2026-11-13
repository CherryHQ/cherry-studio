import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LinkComposerToken } from '../ComposerToken'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const url = 'https://example.com/docs'
const token = { id: 'link:docs', kind: 'link' as const, label: 'example.com/docs', promptText: url }

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  cleanup()
})

describe('sent link text selection', () => {
  it('does not navigate when a click ends a selection inside the link', () => {
    const onOpenLink = vi.fn()
    render(<LinkComposerToken token={token} readOnly onOpenLink={onOpenLink} />)
    const link = screen.getByRole('link', { name: url })
    const text = screen.getByText(token.label).firstChild!
    const range = document.createRange()
    range.setStart(text, 2)
    range.setEnd(text, 7)
    window.getSelection()!.addRange(range)

    fireEvent.click(link)

    expect(window.getSelection()!.toString()).toBe('ample')
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('still opens by mouse and keyboard without a link selection', async () => {
    const user = userEvent.setup()
    const onOpenLink = vi.fn()
    render(<LinkComposerToken token={token} readOnly onOpenLink={onOpenLink} />)
    const link = screen.getByRole('link', { name: url })

    await user.click(link)
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(url)

    onOpenLink.mockClear()
    await user.keyboard('{Enter}')
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(url)
  })
})
