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

  it('renders emoji avatars with the EmojiIcon background treatment', () => {
    const { container } = render(<UserAvatar user={{ name: 'User', avatar: '🌈' }} />)

    const background = container.querySelector('[aria-hidden="true"]')

    expect(background).toHaveClass('scale-150', 'opacity-40', 'blur-[5px]')
    expect(background).toHaveTextContent('🌈')
    expect(container.firstChild).not.toHaveClass('from-blue-400', 'to-indigo-500')
  })
})
