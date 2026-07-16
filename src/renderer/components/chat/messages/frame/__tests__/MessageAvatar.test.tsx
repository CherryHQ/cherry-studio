import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import MessageAvatar from '../MessageAvatar'

describe('MessageAvatar', () => {
  it('renders emoji avatars at the shared 30px message size', () => {
    const { container } = render(<MessageAvatar avatar="🍣" />)
    const avatar = container.querySelector<HTMLElement>('.message-avatar > div')

    expect(avatar).toHaveClass('rounded-full', 'mr-0')
    expect(avatar).toHaveStyle({ width: '30px', height: '30px', fontSize: '17px' })
  })

  it('renders image avatars at the shared 30px message size', () => {
    const { container } = render(<MessageAvatar avatar="https://example.com/avatar.png" />)

    expect(container.querySelector('.message-avatar > *')).toHaveClass('size-full')
  })

  it.each(['🍣', 'https://example.com/avatar.png'])(
    'supports accessible interaction for %s avatars',
    async (avatar) => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { getByRole } = render(<MessageAvatar avatar={avatar} aria-label="Edit author" onClick={onClick} />)
      const avatarButton = getByRole('button', { name: 'Edit author' })

      await user.click(avatarButton)
      avatarButton.focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')

      expect(onClick).toHaveBeenCalledTimes(3)
    }
  )
})
