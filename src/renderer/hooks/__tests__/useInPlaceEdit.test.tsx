import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useInPlaceEdit } from '../useInPlaceEdit'

function RenameNavigationHarness({ onSave }: { onSave?: (value: string) => void }) {
  const [treeRevision, setTreeRevision] = useState(0)
  const [selectedNote, setSelectedNote] = useState('Current note')
  const editor = useInPlaceEdit({
    onSave: (value) => {
      onSave?.(value)
      setTreeRevision((revision) => revision + 1)
    }
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for the pointer click before blur-save remounts the target row', async () => {
    vi.useFakeTimers()
    render(<RenameNavigationHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename current note' }))
    const input = screen.getByRole('textbox', { name: 'Note name' })
    fireEvent.change(input, { target: { value: 'Renamed note' } })
    const otherNote = screen.getByRole('button', { name: 'Other note' })

    fireEvent.pointerDown(otherNote)
    fireEvent.blur(input, { relatedTarget: otherNote })
    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
    })

    expect(screen.getByRole('status', { name: 'Tree revision' })).toHaveTextContent('0')

    fireEvent.pointerUp(otherNote)
    fireEvent.click(otherNote)
    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
    })

    expect(screen.getByRole('status', { name: 'Selected note' })).toHaveTextContent('Other note')
    expect(screen.getByRole('status', { name: 'Tree revision' })).toHaveTextContent('1')
  })

  it('flushes a pending blur-save when the editor unmounts', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const view = render(<RenameNavigationHarness onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename current note' }))
    const input = screen.getByRole('textbox', { name: 'Note name' })
    fireEvent.change(input, { target: { value: 'Renamed note' } })
    const otherNote = screen.getByRole('button', { name: 'Other note' })
    fireEvent.pointerDown(otherNote)
    fireEvent.blur(input, { relatedTarget: otherNote })

    view.unmount()

    expect(onSave).toHaveBeenCalledWith('Renamed note')
  })
})
