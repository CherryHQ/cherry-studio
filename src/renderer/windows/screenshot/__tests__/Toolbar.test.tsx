import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { PropsWithChildren } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Toolbar } from '../components/Toolbar'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/popover')),
  Textarea: await import('@cherrystudio/ui/components/primitives/textarea'),
  NormalTooltip: ({ children }: PropsWithChildren) => children
}))

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

  it('lets the user attach a message and keeps the message editable after delivery fails', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('target unavailable')).mockResolvedValue(undefined)
    render(<Toolbar {...baseProps} activeTool={null} onSendToChat={onSend} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'Explain this screenshot')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to chat' }))
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox')).toHaveValue('Explain this screenshot')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to chat' }))
    expect(onSend).toHaveBeenLastCalledWith('Explain this screenshot')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
