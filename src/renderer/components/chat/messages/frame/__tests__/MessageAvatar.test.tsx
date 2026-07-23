import { fireEvent, render } from '@testing-library/react'
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

  it.each(['🍣', 'https://example.com/avatar.png'])('forwards clicks for %s avatars', (avatar) => {
    const onClick = vi.fn()
    const { container } = render(<MessageAvatar avatar={avatar} onClick={onClick} />)

    fireEvent.click(container.querySelector('.message-avatar') as HTMLElement)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
