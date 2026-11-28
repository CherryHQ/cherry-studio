import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserAvatar } from '../primitives'

describe('UserAvatar', () => {
  it('renders file url avatars as images', () => {
    const avatar = 'file:///tmp/avatar.png'

    render(<UserAvatar user={{ name: 'User', avatar }} />)

    const image = screen.getByRole('img', { name: 'User' })
    expect(image).toHaveAttribute('src', avatar)
    expect(image.parentElement).not.toHaveClass('ring-1')
    expect(screen.queryByText(avatar)).not.toBeInTheDocument()
  })

  it('shows the saved emoji instead of falling back to the user initial', () => {
    render(<UserAvatar user={{ name: 'User', avatar: '🌈' }} />)

    const emojiIcon = screen.getByTestId('emoji-icon')
    expect(emojiIcon).toHaveTextContent('🌈')
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})
