import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserAvatar } from '../primitives'

describe('UserAvatar', () => {
  it('renders file url avatars as images', () => {
    const avatar = 'file:///tmp/avatar.png'

    render(<UserAvatar user={{ name: 'User', avatar }} />)

    expect(screen.getByRole('img', { name: 'User' })).toHaveAttribute('src', avatar)
    expect(screen.queryByText(avatar)).not.toBeInTheDocument()
  })

  it('renders emoji avatars via EmojiIcon (no gradient initials fallback)', () => {
    const { container } = render(<UserAvatar user={{ name: 'User', avatar: '🌈' }} />)

    const emojiIcon = screen.getByTestId('emoji-icon')
    expect(emojiIcon).toHaveTextContent('🌈')
    expect(screen.getByTestId('emoji-icon-background')).toHaveTextContent('🌈')
    // Emoji avatars must not fall through to the gradient-initial branch.
    expect(container.firstChild).not.toHaveClass('from-blue-400', 'to-indigo-500')
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})
