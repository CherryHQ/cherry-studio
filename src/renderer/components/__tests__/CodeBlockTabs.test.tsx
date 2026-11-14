import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { CodeBlockTabs } from '../CodeBlockTabs'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function Draft({ source }: { source: string }) {
  const [draft, setDraft] = useState(source)
  return <textarea aria-label="Source" value={draft} onChange={(event) => setDraft(event.target.value)} />
}

const items = [
  { id: 'one', label: 'typescript', content: <Draft source="const one = 1" /> },
  { id: 'two', label: 'python', content: <Draft source="print(2)" /> }
]

describe('CodeBlockTabs', () => {
  it('loads panels on first visit and retains independent drafts without exposing hidden controls', async () => {
    const user = userEvent.setup()
    render(<CodeBlockTabs label="Code blocks" items={items} />)
    expect(screen.queryByDisplayValue('print(2)')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Source' }), ' // draft')
    await user.click(screen.getByRole('tab', { name: 'python' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox')).toHaveValue('print(2)')
    await user.click(screen.getByRole('tab', { name: 'typescript' }))
    expect(screen.getByRole('textbox')).toHaveValue('const one = 1 // draft')
  })

  it('supports keyboard activation and keeps selection when items append, falling back when selected item is removed', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CodeBlockTabs label="Code blocks" items={items} />)
    await user.click(screen.getByRole('tab', { name: 'typescript' }))
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'python' })).toHaveAttribute('aria-selected', 'true'))
    rerender(
      <CodeBlockTabs label="Code blocks" items={[...items, { id: 'three', label: 'css', content: 'body {}' }]} />
    )
    expect(within(screen.getByRole('tabpanel')).getByRole('textbox')).toHaveValue('print(2)')
    rerender(<CodeBlockTabs label="Code blocks" items={[items[0]]} />)
    expect(screen.getByRole('tab', { name: 'typescript' })).toHaveAttribute('aria-selected', 'true')
  })
})
