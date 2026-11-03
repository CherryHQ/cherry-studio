import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import katex from 'katex'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext } from '@renderer/hooks/command'
import '@renderer/services/ExportService'
import { addNote } from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'

import SelectionContextMenu from '../SelectionContextMenu'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/services/NotesService', () => ({ addNote: vi.fn() }))

function renderContent(
  content = 'Ignore this.\nKeep this excerpt.\nIgnore that.',
  mode: 'cherry' | 'native' = 'cherry'
) {
  return render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: mode, shortcutPreferences: {} }}>
      <SelectionContextMenu>
        <p>{content}</p>
      </SelectionContextMenu>
    </CommandSharedPreferencesContext>
  )
}

async function selectText(element: HTMLElement, start = 0, end = element.textContent.length) {
  fireEvent(element, new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  const range = document.createRange()
  range.setStart(element.firstChild!, start)
  range.setEnd(element.firstChild!, end)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent(element, new MouseEvent('pointerup', { button: 0, bubbles: true }))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.getSelection()?.removeAllRanges()
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/synthetic-notes')
  MockUsePreferenceUtils.setPreferenceValue('chat.message.math.single_dollar', false)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(100, 100, 180, 20)
  })
  vi.mocked(addNote).mockResolvedValue({ path: '/synthetic-notes/Excerpt (1).md', name: 'Excerpt (1)' })
})

describe('saving selected conversation text to Notes', () => {
  it('saves only the selected passage from the real floating toolbar and offers the shared open action', async () => {
    const user = userEvent.setup()
    renderContent()
    await selectText(screen.getByText(/Ignore this/), 13, 31)
    await user.click(await screen.findByRole('button', { name: 'notes.save' }))

    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith('Keep this excerpt.', 'Keep this excerpt.', '/synthetic-notes')
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'message.success.notes.export',
          action: expect.objectContaining({ label: 'notes.open' })
        })
      )
    )
    expect(screen.queryByRole('button', { name: 'notes.save' })).not.toBeInTheDocument()
    expect(screen.getByText(/Ignore this/)).toHaveTextContent('Ignore this.')
  })

  it('captures the context-menu selection before focus or the live selection changes', async () => {
    const user = userEvent.setup()
    renderContent('First paragraph.\n\nSecond paragraph.')
    const content = screen.getByText(/First paragraph/)
    await selectText(content)
    fireEvent.contextMenu(content)
    const save = await screen.findByRole('menuitem', { name: 'notes.save' })
    window.getSelection()?.removeAllRanges()
    await user.click(save)

    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith(
        'First paragraph.',
        'First paragraph.\n\nSecond paragraph.',
        '/synthetic-notes'
      )
    )
  })

  it('saves the captured passage through the native context-menu adapter', async () => {
    const popup = vi.fn().mockResolvedValue({ type: 'custom', id: 'selection.save-notes' })
    window.api.command = { ...window.api.command, showNativePopupMenu: popup }
    renderContent('Native menu excerpt', 'native')
    const content = screen.getByText('Native menu excerpt')
    await selectText(content)
    fireEvent.contextMenu(content)
    window.getSelection()?.removeAllRanges()

    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith('Native menu excerpt', 'Native menu excerpt', '/synthetic-notes')
    )
  })

  it('does not save a selection belonging to another message surface', () => {
    render(
      <>
        <p>Outside passage</p>
        <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
          <SelectionContextMenu>
            <p>Current message</p>
          </SelectionContextMenu>
        </CommandSharedPreferencesContext>
      </>
    )
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Outside passage'))
    window.getSelection()!.addRange(range)
    fireEvent.contextMenu(screen.getByText('Current message'))
    expect(screen.queryByRole('menuitem', { name: 'notes.save' })).not.toBeInTheDocument()
    expect(addNote).not.toHaveBeenCalled()
  })

  it('restores Markdown math delimiters when saving a rendered formula', async () => {
    const user = userEvent.setup()
    render(
      <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
        <SelectionContextMenu>
          <p aria-label="Formula" dangerouslySetInnerHTML={{ __html: katex.renderToString('x^2') }} />
        </SelectionContextMenu>
      </CommandSharedPreferencesContext>
    )
    const content = screen.getByLabelText('Formula')
    const range = document.createRange()
    range.selectNodeContents(content)
    window.getSelection()!.addRange(range)
    fireEvent.contextMenu(content)
    await user.click(await screen.findByRole('menuitem', { name: 'notes.save' }))

    await waitFor(() => expect(addNote).toHaveBeenCalledWith('\\(x^2\\)', '\\(x^2\\)', '/synthetic-notes'))
  })

  it('blocks another save while a write is pending and permits a fresh save after completion', async () => {
    const user = userEvent.setup()
    let complete!: (value: Awaited<ReturnType<typeof addNote>>) => void
    vi.mocked(addNote).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    renderContent('One excerpt')
    const content = screen.getByText('One excerpt')
    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'notes.save' }))
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1))
    await selectText(content)
    expect(await screen.findByRole('button', { name: 'notes.save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'notes.save' }))
    expect(addNote).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(content)
    expect(await screen.findByRole('menuitem', { name: 'notes.save' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')

    await act(async () => {
      complete({ path: '/synthetic-notes/One.md', name: 'One' })
    })
    await selectText(content)
    await waitFor(() => expect(screen.getByRole('button', { name: 'notes.save' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'notes.save' }))
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2))
  })

  it('shows the existing error without a success action and lets the user retry', async () => {
    const user = userEvent.setup()
    vi.mocked(addNote).mockRejectedValueOnce(new Error('Synthetic write failure'))
    renderContent('Retry this excerpt')
    const content = screen.getByText('Retry this excerpt')
    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'notes.save' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('message.error.notes.export'))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(content).toHaveTextContent('Retry this excerpt')

    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'notes.save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(addNote).toHaveBeenCalledTimes(2)
  })

  it('does not offer Notes saving for an editable message draft', async () => {
    render(
      <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
        <SelectionContextMenu>
          <div contentEditable suppressContentEditableWarning>
            Unsent draft
          </div>
        </SelectionContextMenu>
      </CommandSharedPreferencesContext>
    )
    const draft = screen.getByText('Unsent draft')
    await selectText(draft)
    expect(screen.queryByRole('button', { name: 'notes.save' })).not.toBeInTheDocument()
    fireEvent.contextMenu(draft)
    expect(screen.queryByRole('menuitem', { name: 'notes.save' })).not.toBeInTheDocument()
    expect(addNote).not.toHaveBeenCalled()
  })

  it('does not write a blank selection', async () => {
    const user = userEvent.setup()
    renderContent('Before   After')
    await selectText(screen.getByText('Before After'), 6, 9)
    await user.click(await screen.findByRole('button', { name: 'notes.save' }))
    expect(addNote).not.toHaveBeenCalled()
  })
})
