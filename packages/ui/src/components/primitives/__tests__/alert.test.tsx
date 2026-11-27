// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Alert } from '../alert'

afterEach(() => {
  cleanup()
})

describe('Alert', () => {
  it('renders message and description', () => {
    render(<Alert type="error" message="Failed" description="Something went wrong" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it.each(['info', 'success', 'warning', 'error'] as const)(
    'announces %s with the appropriate live-region role',
    (type) => {
      render(<Alert type={type} message="Message" showIcon={type !== 'warning'} />)

      expect(screen.getByRole(type === 'error' ? 'alert' : 'status')).toHaveTextContent('Message')
    }
  )
})
