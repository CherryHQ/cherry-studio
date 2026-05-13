import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CodeHeroIllustrationIcon } from '../CodeHeroIllustrationIcon'

describe('CodeHeroIllustrationIcon', () => {
  it('renders the code hero illustration asset inside an svg icon wrapper', () => {
    render(<CodeHeroIllustrationIcon aria-label="Code tools" />)

    const icon = screen.getByRole('img', { name: 'Code tools' })
    expect(icon.querySelector('image')).toBeInTheDocument()
    expect(icon.querySelector('image')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  })
})
