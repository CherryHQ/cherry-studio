import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import LogoAvatar from '../LogoAvatar'

const LOGO_SRC = 'https://example.com/logo.png'

afterEach(() => {
  cleanup()
})

describe('LogoAvatar URL logos', () => {
  it('keeps an unnamed URL logo in the accessibility tree by default', () => {
    render(<LogoAvatar logo={LOGO_SRC} />)

    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', LOGO_SRC)
    expect(image).not.toHaveAttribute('alt', '')
  })

  it('hides a URL logo from the accessibility tree when alt is empty', () => {
    render(<LogoAvatar logo={LOGO_SRC} alt="" />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('names a URL logo when alt is provided', () => {
    render(<LogoAvatar logo={LOGO_SRC} alt="ChatGPT" />)

    expect(screen.getByRole('img', { name: 'ChatGPT' })).toHaveAttribute('src', LOGO_SRC)
  })
})
