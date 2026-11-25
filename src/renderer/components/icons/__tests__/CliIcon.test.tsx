import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { CliIcon } from '../CliIcon'

afterEach(cleanup)

it('renders the fallback for an unknown tool with a prototype property name', () => {
  render(<CliIcon id="constructor" />)

  expect(screen.getByText('C')).toBeVisible()
})
