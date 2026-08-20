import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useInPlaceEdit } from '../useInPlaceEdit'

function RenameNavigationHarness() {
  const [treeRevision, setTreeRevision] = useState(0)
  const [selectedNote, setSelectedNote] = useState('Current note')
  const editor = useInPlaceEdit({
    onSave: () => setTreeRevision((revision) => revision + 1)
  })

  return (
    <div>
      {editor.isEditing ? (
        <input aria-label="Note name" {...editor.inputProps} />
      ) : (
        <button type="button" onClick={() => editor.startEdit('Current note')}>
          Rename current note
        </button>
      )}
      <button key={treeRevision} type="button" onClick={() => setSelectedNote('Other note')}>
        Other note
      </button>
      <output aria-label="Selected note">{selectedNote}</output>
      <output aria-label="Tree revision">{treeRevision}</output>
    </div>
  )
}

describe('useInPlaceEdit', () => {
  it('lets the first click select another note while blur saves the rename', async () => {
    const user = userEvent.setup()
    render(<RenameNavigationHarness />)

    await user.click(screen.getByRole('button', { name: 'Rename current note' }))
    const input = screen.getByRole('textbox', { name: 'Note name' })
    await user.clear(input)
    await user.type(input, 'Renamed note')

    await user.click(screen.getByRole('button', { name: 'Other note' }))

    expect(screen.getByRole('status', { name: 'Selected note' })).toHaveTextContent('Other note')
    await waitFor(() => expect(screen.getByRole('status', { name: 'Tree revision' })).toHaveTextContent('1'))
  })
})
