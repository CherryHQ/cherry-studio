import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import SelectionActionIcon from '../SelectionActionIcon'

describe('SelectionActionIcon', () => {
  it('shows the supplied fallback when no icon is configured', () => {
    render(<SelectionActionIcon fallback={() => <span>Missing icon</span>} />)

    expect(screen.getByText('Missing icon')).toBeInTheDocument()
  })

  it('loads a valid custom icon and replaces its loading fallback', async () => {
    render(<SelectionActionIcon name="heart" data-testid="action-icon" fallback={() => <span>Loading icon</span>} />)

    expect(await screen.findByTestId('action-icon')).toBeInTheDocument()
    expect(screen.queryByText('Loading icon')).not.toBeInTheDocument()
  })

  it.each(['constructor', '__proto__', 'toString', 'not-a-lucide-icon'])(
    'replaces a previously loaded icon with the fallback when the saved name becomes %s',
    async (name) => {
      const fallback = () => <span>Missing icon</span>
      const { rerender } = render(<SelectionActionIcon name="heart" data-testid="action-icon" fallback={fallback} />)
      await screen.findByTestId('action-icon')

      rerender(<SelectionActionIcon name={name} data-testid="action-icon" fallback={fallback} />)

      await waitFor(() => {
        expect(screen.getByText('Missing icon')).toBeInTheDocument()
        expect(screen.queryByTestId('action-icon')).not.toBeInTheDocument()
      })
    }
  )
})
