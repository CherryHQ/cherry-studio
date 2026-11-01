import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from '../Sidebar'

vi.unmock('@cherrystudio/ui')

describe('Sidebar application discovery', () => {
  it('guides an empty list without adding a second launcher', () => {
    render(
      <Sidebar
        width={200}
        setWidth={vi.fn()}
        entries={[]}
        emptyHint="Right-click an app in Launchpad to pin it here."
      />
    )

    expect(screen.getByText('Right-click an app in Launchpad to pin it here.')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
