import type * as CherryStudioUi from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

import { UserAvatar } from '../primitives'

describe('UserAvatar', () => {
  it('renders file url avatars as images', () => {
    const avatar = 'file:///tmp/avatar.png'

    render(<UserAvatar user={{ name: 'User', avatar }} />)

    expect(screen.getByRole('img', { name: 'User' })).toHaveAttribute('src', avatar)
    expect(screen.queryByText(avatar)).not.toBeInTheDocument()
  })

  it('renders emoji avatars via EmojiAvatar (no gradient initials fallback)', () => {
    const { container } = render(<UserAvatar user={{ name: 'User', avatar: '🌈' }} />)

    const emojiAvatar = container.firstElementChild?.firstElementChild as HTMLElement
    expect(emojiAvatar).toHaveClass('h-full', 'w-full', 'rounded-full', 'border-0')
    expect(emojiAvatar).toHaveStyle({ width: '100%', height: '100%', fontSize: '14px' })
    expect(emojiAvatar).toHaveTextContent('🌈')
    expect(emojiAvatar.querySelector('svg[data-fluent-emoji="🌈"]')).not.toBeInTheDocument()
    // Emoji avatars must not fall through to the gradient-initial branch.
    // The gradient classes live on the inner fallback div, so query that element directly.
    expect(container.querySelector('.from-blue-400')).not.toBeInTheDocument()
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})
