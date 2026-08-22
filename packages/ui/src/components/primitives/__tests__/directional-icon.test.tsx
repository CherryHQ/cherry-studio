// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { ArrowRight } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'

import { DirectionalIcon } from '../directional-icon'

afterEach(() => {
  cleanup()
})

describe('DirectionalIcon', () => {
  it('mirrors an opted-in icon from the global RTL direction', () => {
    render(
      <DirectionalIcon>
        <ArrowRight aria-label="Next" />
      </DirectionalIcon>
    )

    expect(screen.getByLabelText('Next')).toHaveAttribute('data-slot', 'directional-icon')
    expect(screen.getByLabelText('Next')).not.toHaveClass('-scale-x-100')
    expect(screen.getByLabelText('Next')).toHaveClass('rtl:-scale-x-100')
  })
})
