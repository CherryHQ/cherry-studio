// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EntityAvatarIcon } from '../EntityAvatarIcon'

afterEach(cleanup)

describe('EntityAvatarIcon', () => {
  it('renders the selected emoji representation', () => {
    render(<EntityAvatarIcon avatar={{ kind: 'emoji', emoji: '🦞' }} />)

    expect(screen.getAllByText('🦞')).not.toHaveLength(0)
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders only the selected image representation', () => {
    render(
      <EntityAvatarIcon
        avatar={{
          kind: 'image',
          fileId: '019606a0-0000-7000-8000-000000000001',
          src: 'file:///tmp/avatar.png'
        }}
      />
    )

    expect(document.querySelector('img')).toHaveAttribute('src', 'file:///tmp/avatar.png')
    expect(screen.queryByText('⭐️')).not.toBeInTheDocument()
  })
})
