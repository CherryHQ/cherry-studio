import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext } from '@renderer/hooks/command'

import SelectionContextMenu from '../SelectionContextMenu'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function renderContent() {
  return render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <SelectionContextMenu>
        <div>
          <p>Selected message text</p>
          <div contentEditable suppressContentEditableWarning>
            Editable draft
          </div>
        </div>
      </SelectionContextMenu>
      <p>Outside content</p>
    </CommandSharedPreferencesContext>
  )
}

async function selectText(element: HTMLElement, endElement = element, duringSelection?: () => void) {
  fireEvent(element, new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  const range = document.createRange()
  range.setStart(element.firstChild!, 0)
  range.setEnd(endElement.firstChild!, endElement.textContent.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
  duringSelection?.()
  fireEvent(endElement, new MouseEvent('pointerup', { button: 0, bubbles: true }))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

describe('automatic selected-text actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.getSelection()?.removeAllRanges()
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(100, 100, 180, 20)
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    window.api.quoteToMainWindow = vi.fn().mockResolvedValue(undefined)
  })

  it('copies and quotes a completed selection without opening the context menu', async () => {
    const user = userEvent.setup()
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content)

    await user.click(await screen.findByRole('button', { name: 'common.copy' }))
    expect(await navigator.clipboard.readText()).toBe('Selected message text')
    expect(window.getSelection()?.toString()).toBe('Selected message text')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'chat.message.quote' })).not.toBeInTheDocument())

    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'chat.message.quote' }))
    expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Selected message text')
  })

  it('excludes editable content, outside selections, and selections crossing the scope boundary', async () => {
    renderContent()
    await selectText(screen.getByText('Editable draft'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    await selectText(screen.getByText('Outside content'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    await selectText(screen.getByText('Selected message text'), screen.getByText('Outside content'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
  })

  it('shows actions after completing a drag that scrolls the message', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => fireEvent.scroll(content))
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it('updates the measured anchor when an open selection grows', async () => {
    let selectionRect = new DOMRect(100, 100, 80, 20)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => selectionRect
    })
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    const popup = await screen.findByRole('dialog')
    // Radix exposes the measured anchor width that drives the open popup's positioning.
    const anchorWidth = () => popup.parentElement?.style.getPropertyValue('--radix-popper-anchor-width')
    await waitFor(() => expect(anchorWidth()).toBe('80px'))

    selectionRect = new DOMRect(100, 100, 210, 20)
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))

    await waitFor(() => expect(anchorWidth()).toBe('210px'))
  })

  it('keeps actions hidden until keyboard selection and scrolling finish', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.scroll(content)
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.keyUp(document, { key: 'ArrowDown', shiftKey: true })
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it('waits for selection keys to finish across modifier releases and consecutive gestures', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'ArrowDown', ctrlKey: true, shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 12)
    fireEvent(document, new Event('selectionchange'))
    fireEvent.keyUp(document, { key: 'Control', shiftKey: true })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()

    fireEvent.keyUp(document, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true })
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it.each(['escape', 'scroll', 'blur', 'collapse'] as const)('dismisses on %s', async (reason) => {
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await screen.findByRole('button', { name: 'common.copy' })
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (reason === 'scroll') fireEvent.scroll(screen.getByText('Selected message text'))
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    if (reason === 'collapse') {
      window.getSelection()?.removeAllRanges()
      fireEvent(document, new Event('selectionchange'))
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument())
  })
})
