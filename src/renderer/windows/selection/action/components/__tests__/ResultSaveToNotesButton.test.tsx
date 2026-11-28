import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { addNote } from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'

import { ResultSaveToNotesButton } from '../ResultSaveToNotesButton'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/services/NotesService', () => ({ addNote: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn().mockResolvedValue(undefined) }
}))

describe('ResultSaveToNotesButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/synthetic-notes')
    vi.mocked(addNote).mockResolvedValue({
      path: '/synthetic-notes/Selected passage.md',
      name: 'Selected passage'
    })
  })

  it('saves both selected original text and result text to Notes and offers Open action', async () => {
    const user = userEvent.setup()
    render(
      <ResultSaveToNotesButton selectedText={'Selected passage\nSecond line'} resultText="Explained result content" />
    )

    await user.click(screen.getByRole('button', { name: 'notes.save' }))

    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith(
        'Selected passage',
        '> Selected passage\n> Second line\n\nExplained result content',
        '/synthetic-notes'
      )
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'message.success.notes.export',
          action: expect.objectContaining({ label: 'notes.open' })
        })
      )
    )

    const toastPayload = vi.mocked(toast.success).mock.calls[0][0] as {
      action: { onClick: () => void }
    }
    toastPayload.action.onClick()
    expect(ipcApi.request).toHaveBeenCalledWith('navigation.open_route_in_main', {
      path: '/app/notes?notePath=%2Fsynthetic-notes%2FSelected+passage.md'
    })
  })

  it('skips fence lines for title derivation and saves result cleanly when selected text is absent', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ResultSaveToNotesButton selectedText={'```ts\nconst x = 1\n```'} resultText="Declares x" />
    )

    await user.click(screen.getByRole('button', { name: 'notes.save' }))
    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith(
        'const x = 1',
        '> ```ts\n> const x = 1\n> ```\n\nDeclares x',
        '/synthetic-notes'
      )
    )

    vi.mocked(addNote).mockClear()
    rerender(<ResultSaveToNotesButton selectedText={undefined} resultText="Standalone result" />)
    await user.click(screen.getByRole('button', { name: 'notes.save' }))
    await waitFor(() =>
      expect(addNote).toHaveBeenCalledWith('Standalone result', 'Standalone result', '/synthetic-notes')
    )
  })

  it('disables itself while saving to prevent duplicate writes and re-enables after completion', async () => {
    const user = userEvent.setup()
    let resolveWrite!: (value: { path: string; name: string }) => void
    vi.mocked(addNote).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveWrite = resolve
      })
    )

    render(<ResultSaveToNotesButton selectedText="Original text" resultText="Generated result" />)

    const button = screen.getByRole('button', { name: 'notes.save' })
    await user.click(button)

    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1))
    expect(button).toBeDisabled()
    await user.click(button)
    expect(addNote).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveWrite({ path: '/synthetic-notes/Original text.md', name: 'Original text' })
    })

    await waitFor(() => expect(button).toBeEnabled())
  })

  it('stays disabled when resultText is empty or blank', async () => {
    const user = userEvent.setup()
    render(<ResultSaveToNotesButton selectedText="Original text" resultText="   " />)

    const button = screen.getByRole('button', { name: 'notes.save' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(addNote).not.toHaveBeenCalled()
  })

  it('shows an error toast when saving fails and allows retrying', async () => {
    const user = userEvent.setup()
    vi.mocked(addNote).mockRejectedValueOnce(new Error('Disk write failed'))

    render(<ResultSaveToNotesButton selectedText="Retry original" resultText="Retry result" />)

    const button = screen.getByRole('button', { name: 'notes.save' })
    await user.click(button)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('message.error.notes.export'))
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(button).toBeEnabled())

    await user.click(button)
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(addNote).toHaveBeenCalledTimes(2)
  })
})
