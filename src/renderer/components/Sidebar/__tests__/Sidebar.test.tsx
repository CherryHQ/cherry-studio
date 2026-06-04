import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserAvatar } from '../primitives'

describe('UserAvatar', () => {
  it('renders file url avatars as images', () => {
    const avatar =
      'file:///Applications/Cherry%20Studio%20Next.app/Contents/Resources/app.asar/out/renderer/assets/avatar-Xp_AWgeD.png'

    render(<UserAvatar user={{ name: 'User', avatar }} />)

    expect(screen.getByRole('img', { name: 'User' })).toHaveAttribute('src', avatar)
    expect(screen.queryByText(avatar)).not.toBeInTheDocument()
  })
})
