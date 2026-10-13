import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ToolResultLink } from '../shared/ToolResultLink'

const openExternalUrl = vi.hoisted(() => vi.fn())
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ openExternalUrl })
}))

describe('ToolResultLink', () => {
  it('falls back to an actionable link after a failed image and retries a new source', async () => {
    const user = userEvent.setup()
    const url = 'https://example.com/expired.png?signature=abc'
    const { rerender } = render(<ToolResultLink url={url} isImage />)

    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img', { name: 'message.tools.sections.output' })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: url })
    expect(link).toHaveAttribute('href', url)
    await user.click(link)
    expect(openExternalUrl).toHaveBeenCalledWith(url)

    rerender(<ToolResultLink url="https://example.com/fresh.png" isImage />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/fresh.png')
  })
})
