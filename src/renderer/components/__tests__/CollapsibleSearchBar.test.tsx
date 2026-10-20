import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import CollapsibleSearchBar from '../CollapsibleSearchBar'

describe('CollapsibleSearchBar', () => {
  it('keeps collapsed controls out of the tab order and supports keyboard search', async () => {
    const user = userEvent.setup()
    const onSearch = vi.fn()

    render(
      <CollapsibleSearchBar
        onSearch={onSearch}
        tooltip="Search tasks"
        clearLabel="Clear search"
        placeholder="Search scheduled tasks"
        animated={false}
      />
    )

    const input = screen.getByRole('searchbox', { hidden: true, name: 'Search tasks' })
    expect(input).toHaveAttribute('tabindex', '-1')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Search tasks' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(input).toHaveFocus()

    await user.type(input, 'daily')
    expect(onSearch).toHaveBeenLastCalledWith('daily')

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('button', { name: 'Search tasks' })).toHaveFocus()
  })

  it('reflects search text cleared by its parent', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [value, setValue] = useState('')

      return (
        <>
          <CollapsibleSearchBar
            value={value}
            onSearch={setValue}
            tooltip="Search tasks"
            placeholder="Search scheduled tasks"
            animated={false}
          />
          <button type="button" onClick={() => setValue('')}>
            Clear filters
          </button>
        </>
      )
    }

    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Search tasks' }))
    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    await user.type(input, 'daily')
    expect(input).toHaveValue('daily')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(input).toHaveValue('')
  })
})
