// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { ArrowRight } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'

import { DirectionProvider } from '../direction'
import { DirectionalIcon } from '../directional-icon'

afterEach(() => {
  cleanup()
})

describe('DirectionalIcon', () => {
  it('leaves a directional icon unchanged in LTR', () => {
    render(
      <DirectionProvider dir="ltr">
        <DirectionalIcon>
          <ArrowRight aria-label="Next" />
        </DirectionalIcon>
      </DirectionProvider>
    )

    expect(screen.getByLabelText('Next')).toHaveAttribute('data-slot', 'directional-icon')
    expect(screen.getByLabelText('Next')).not.toHaveClass('-scale-x-100')
  })

  it('mirrors an opted-in directional icon in RTL', () => {
    render(
      <DirectionProvider dir="rtl">
        <DirectionalIcon>
          <ArrowRight aria-label="Next" />
        </DirectionalIcon>
      </DirectionProvider>
    )

    expect(screen.getByLabelText('Next')).toHaveClass('-scale-x-100')
  })
})
