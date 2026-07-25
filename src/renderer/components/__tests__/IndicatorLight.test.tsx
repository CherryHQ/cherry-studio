import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import IndicatorLight from '../IndicatorLight'

describe('IndicatorLight', () => {
  it('should render with default props', () => {
    const { container } = render(<IndicatorLight color="red" />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
