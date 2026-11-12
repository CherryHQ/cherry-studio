// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageHeader } from '../index'

afterEach(() => {
  cleanup()
})

describe('PageHeader', () => {
  it('renders title inside an h2', () => {
    render(<PageHeader title="Settings" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Settings')
  })
})
