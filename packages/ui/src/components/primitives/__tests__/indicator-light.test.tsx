// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import IndicatorLight from '../indicator-light'

afterEach(() => {
  cleanup()
})

describe('IndicatorLight', () => {
  it('maps green to the exported success token', () => {
    const { container } = render(<IndicatorLight color="green" />)

    expect(container.firstChild).toHaveStyle({
      backgroundColor: 'var(--color-success)',
      boxShadow: '0 0 6px var(--color-success)'
    })
  })
})
