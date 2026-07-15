import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
