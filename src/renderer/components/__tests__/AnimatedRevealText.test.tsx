import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import AnimatedRevealText from '../AnimatedRevealText'

describe('AnimatedRevealText', () => {
  it('renders accessible single-layer text', () => {
    const { container } = render(<AnimatedRevealText text="Hello" />)

    const root = container.querySelector('[data-slot="animated-reveal-text"]')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('aria-label', 'Hello')
    expect(root).toHaveTextContent('Hello')
    expect(container.querySelector('.animated-reveal-text__base')).not.toBeInTheDocument()
    expect(container.querySelector('.animated-reveal-text__fill')).not.toBeInTheDocument()
  })

  it('uses a custom aria label when provided', () => {
    const { container } = render(<AnimatedRevealText text="Hello" ariaLabel="Greeting" />)

    expect(container.querySelector('[data-slot="animated-reveal-text"]')).toHaveAttribute('aria-label', 'Greeting')
  })

  it('does not render blank text', () => {
    const { container } = render(<AnimatedRevealText text="   " />)

    expect(container.querySelector('[data-slot="animated-reveal-text"]')).not.toBeInTheDocument()
  })
})
