import { fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Toolbar } from '../components/Toolbar'

const baseProps = {
  selection: { x: 0, y: 0, width: 400, height: 300 },
  logicalHeight: 800,
  canUndo: true,
  canRedo: true,
  onToolChange: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onOk: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn()
}

describe('Toolbar accessible names', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('names every icon button, the tooltip not being an accessible name', () => {
    render(<Toolbar {...baseProps} activeTool={null} />)

    const names = [
      'Rectangle',
      'Arrow',
      'Brush',
      'Text',
      'Mosaic',
      'Undo',
      'Redo',
      'Save image',
      'Cancel',
      'Copy and close'
    ]
    for (const name of names) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('reports pressed state on the tools only, so the plain actions do not read as toggles', () => {
    render(<Toolbar {...baseProps} activeTool="brush" />)

    expect(screen.getByRole('button', { name: 'Brush' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'false')
    // An always-off aria-pressed here would announce "Save image" as an unchecked toggle.
    expect(screen.getByRole('button', { name: 'Save image' })).not.toHaveAttribute('aria-pressed')
  })
})

describe('Toolbar event containment', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  // A full-screen selection clamps the toolbar inside the selection, where the overlay's
  // double-click-to-confirm would fire on a button press and capture instead.
  it('keeps a double-click on a button from reaching the overlay below', () => {
    const onOverlayDoubleClick = vi.fn()
    render(
      <div onDoubleClick={onOverlayDoubleClick}>
        <Toolbar {...baseProps} activeTool={null} />
      </div>
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Rectangle' }))

    expect(onOverlayDoubleClick).not.toHaveBeenCalled()
  })
})
