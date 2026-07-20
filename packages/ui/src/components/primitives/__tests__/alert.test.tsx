// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { Info } from 'lucide-react'
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

  it('renders the status role for non-error alerts', () => {
    render(<Alert type="warning" message="Heads up" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders optional icon and action', () => {
    render(<Alert type="info" message="Info" showIcon action={<button type="button">Open</button>} />)

    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="alert-icon"] svg')).toBeInTheDocument()
  })

  it.each(['info', 'success', 'warning', 'error'] as const)(
    'marks the default %s icon with its semantic type',
    (type) => {
      render(<Alert type={type} message="Message" showIcon />)

      expect(screen.getByRole(type === 'error' ? 'alert' : 'status')).toHaveAttribute('data-type', type)
      const icon = document.querySelector('[data-slot="alert-icon"] svg')
      expect(icon).toHaveClass('lucide-custom')
      expect(icon?.closest('[data-slot="alert-icon"]')).toHaveAttribute('data-type', type)
    }
  )

  it('applies semantic color to custom lucide icons', () => {
    render(<Alert type="warning" message="Custom icon" showIcon icon={<Info className="custom-class" />} />)

    const iconSlot = document.querySelector('[data-slot="alert-icon"]')
    const icon = document.querySelector('[data-slot="alert-icon"] svg')
    expect(iconSlot).toHaveAttribute('data-type', 'warning')
    expect(icon).toHaveClass('custom-class')
  })
})
