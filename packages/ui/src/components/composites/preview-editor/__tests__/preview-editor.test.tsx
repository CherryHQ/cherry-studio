// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PreviewEditor } from '../preview-editor'

const labels = {
  preview: 'Preview',
  edit: 'Edit',
  save: 'Save',
  discard: 'Discard',
  unsaved: 'Unsaved'
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PreviewEditor', () => {
  it('renders the controlled surface and emits mode changes', () => {
    const onModeChange = vi.fn()

    render(
      <PreviewEditor
        mode="preview"
        onModeChange={onModeChange}
        preview={<div>Rendered preview</div>}
        editor={<div>Editor</div>}
        labels={labels}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />
    )

    expect(screen.getByText('Rendered preview')).toBeInTheDocument()
    expect(screen.queryByText('Editor')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Edit' }))
    expect(onModeChange).toHaveBeenCalledWith('edit')
  })

  it('enables save and discard only for a dirty draft', () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()

    const { rerender } = render(
      <PreviewEditor
        mode="edit"
        onModeChange={vi.fn()}
        preview={<div>Preview</div>}
        editor={<div>Editor surface</div>}
        labels={labels}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    )

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()

    rerender(
      <PreviewEditor
        mode="edit"
        onModeChange={vi.fn()}
        preview={<div>Preview</div>}
        editor={<div>Editor surface</div>}
        labels={labels}
        isDirty
        onSave={onSave}
        onDiscard={onDiscard}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})
