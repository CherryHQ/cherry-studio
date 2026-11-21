import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (original) => original())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: { query: string }) =>
      ({
        'globalSearch.history.title': 'Search history',
        'globalSearch.history.clear': 'Clear search history',
        'globalSearch.history.showAll': 'Show all queries',
        'globalSearch.history.remove': `Remove ${args?.query}`
      })[key] ?? key
  })
}))

import { GlobalSearchQueryHistory } from '../GlobalSearchQueryHistory'

function Harness() {
  const [entries, setEntries] = useState(
    Array.from({ length: 7 }, (_, i) => ({ query: `query ${i}`, lastUsedAt: 7 - i }))
  )
  const [recalled, setRecalled] = useState('')
  return (
    <>
      <input aria-label="Search input" value={recalled} readOnly id="search-input" />
      <GlobalSearchQueryHistory
        entries={entries}
        onRecall={setRecalled}
        onRemove={(query) => setEntries((old) => old.filter((entry) => entry.query !== query))}
        onClear={() => setEntries([])}
        onFocusInput={() => document.getElementById('search-input')?.focus()}
      />
    </>
  )
}

afterEach(cleanup)
describe('query history actions', () => {
  // Real buttons, not UI stand-ins: removal must not recall a query or strand keyboard focus.
  it('supports recall and deletion with keyboard focus continuity through clearing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'query 6', exact: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all queries' }))
    screen.getByRole('button', { name: 'query 6', exact: true }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toHaveValue('query 6')
    await user.click(screen.getByRole('button', { name: 'Remove query 6' }))
    expect(screen.getByRole('button', { name: 'query 5', exact: true })).toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue('query 6')
    await user.click(screen.getByRole('button', { name: 'Clear search history' }))
    expect(screen.queryByRole('region', { name: 'Search history' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })
})
