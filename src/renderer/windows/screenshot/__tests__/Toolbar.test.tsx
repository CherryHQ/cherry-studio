import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { ComponentProps, PropsWithChildren } from 'react'
import { useReducer } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Toolbar as ScreenshotToolbar } from '../components/Toolbar'
import { initialState, overlayReducer } from '../reducer'

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

function Toolbar(props: Omit<ComponentProps<typeof ScreenshotToolbar>, 'resultMessage' | 'onResultMessageChange'>) {
  const [state, dispatch] = useReducer(overlayReducer, {
    ...initialState,
    phase: 'selected',
    selection: props.selection
  })
  return (
    <>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'POINTER_DOWN_SELECTION', x: 10, y: 10 })
          dispatch({ type: 'POINTER_MOVE', x: 30, y: 30 })
        }}>
        Move selection
      </button>
      <button type="button" onClick={() => dispatch({ type: 'POINTER_DOWN_HANDLE', handle: 'se', x: 400, y: 300 })}>
        Resize selection
      </button>
      <button type="button" onClick={() => dispatch({ type: 'POINTER_UP' })}>
        Release selection
      </button>
      {state.phase === 'selected' && (
        <ScreenshotToolbar
          {...props}
          resultMessage={state.resultMessage}
          onResultMessageChange={(text) => dispatch({ type: 'SET_RESULT_MESSAGE', text })}
        />
      )}
    </>
  )
}

describe('Toolbar accessible names', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  it.each(['Move selection', 'Resize selection'])(
    'preserves failed-delivery text after %s unmounts the toolbar',
    async (adjustment) => {
      const onSend = vi.fn().mockRejectedValueOnce(new Error('target unavailable')).mockResolvedValue(undefined)
      render(<Toolbar {...baseProps} activeTool={null} onSubmitResult={onSend} />)
      await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
      await userEvent.type(screen.getByRole('textbox'), 'Keep this message for retry')
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to chat' }))
      expect(screen.getByRole('alert')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      await userEvent.click(screen.getByRole('button', { name: adjustment }))
      expect(screen.queryByRole('button', { name: 'Add to chat' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Release selection' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
      expect(screen.getByRole('textbox')).toHaveValue('Keep this message for retry')
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to chat' }))
      expect(onSend).toHaveBeenLastCalledWith('Keep this message for retry')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('lets the user attach a message and keeps the message editable after delivery fails', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('target unavailable')).mockResolvedValue(undefined)
    render(<Toolbar {...baseProps} activeTool={null} onSubmitResult={onSend} />)
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

  it('keeps the chat entry and message input visible without a destination', async () => {
    render(<Toolbar {...baseProps} activeTool={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'My note')
    expect(within(dialog).getByRole('textbox')).toHaveValue('My note')
    expect(within(dialog).getByRole('button', { name: 'Add to chat' })).toBeDisabled()
    expect(within(dialog).getByText(/Open a chat or Agent conversation/)).toBeInTheDocument()
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
