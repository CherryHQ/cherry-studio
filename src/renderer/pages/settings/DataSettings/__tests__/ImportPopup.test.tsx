import { MockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuery } from '@data/hooks/useDataApi'
import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

const mocks = vi.hoisted(() => ({
  importConversations: vi.fn(),
  openDetail: vi.fn(),
  openFile: vi.fn()
}))

vi.unmock('@data/hooks/useDataApi')

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/services/import', () => ({
  importService: {
    importConversations: mocks.importConversations
  }
}))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => mocks.openDetail(request),
  showDetailOpenFailed: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// The real dialog keeps its focus trap, so keyboard reachability is checked against the shipped modal.
vi.mock('@cherrystudio/ui', async () => {
  const { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } =
    await import('@cherrystudio/ui/components/primitives/dialog')
  return {
    Alert: ({
      children,
      description,
      message,
      role,
      type
    }: PropsWithChildren<{ description?: ReactNode; message?: ReactNode; role?: string; type?: string }>) => (
      <div role={role ?? (type === 'error' ? 'alert' : 'status')}>
        {message}
        {description}
        {children}
      </div>
    ),
    Button: ({
      children,
      disabled,
      loading,
      variant,
      ...props
    }: ComponentProps<'button'> & { loading?: boolean; variant?: string }) => {
      void variant
      return (
        <button {...props} type="button" disabled={disabled || loading} aria-busy={loading || undefined}>
          {children}
        </button>
      )
    },
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  }
})

import ImportPopup from '../ImportPopup'

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window.api.file, { open: mocks.openFile })
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, {})
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('ImportPopup', () => {
  it('keeps one dialog visible while selecting and replaces the help alert with import progress', async () => {
    const user = userEvent.setup()
    let resolveFile!: (file: { content: string }) => void
    let resolveImport!: (result: { success: boolean; topicsCount: number; messagesCount: number }) => void
    let reportProgress!: (progress: number) => void

    mocks.openFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFile = resolve
        })
    )
    mocks.importConversations.mockImplementationOnce(
      (_content: string, _source: string, onProgress: (progress: number) => void) => {
        reportProgress = onProgress
        onProgress(20)
        return new Promise((resolve) => {
          resolveImport = resolve
        })
      }
    )

    render(<PopupHost />)
    act(() => {
      void ImportPopup.show({ source: 'chatgpt' })
    })

    const selectButton = await screen.findByRole('button', { name: 'import.chatgpt.button' })
    await user.click(selectButton)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('import.chatgpt.description')).toBeInTheDocument()
    expect(screen.getByText('import.chatgpt.help.title')).toBeInTheDocument()
    expect(selectButton).toBeDisabled()
    expect(selectButton).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      resolveFile({ content: '[]' })
    })

    const progress = await screen.findByRole('progressbar', { name: 'import.chatgpt.importing' })
    expect(progress).toBeInTheDocument()
    expect(progress).toHaveAttribute('aria-valuenow', '20')
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByText('import.chatgpt.description')).toBeInTheDocument()
    expect(screen.queryByText('import.chatgpt.help.title')).not.toBeInTheDocument()
    expect(selectButton).toBeDisabled()

    act(() => {
      reportProgress(64)
    })

    expect(progress).toHaveAttribute('aria-valuenow', '64')
    expect(screen.getByText('64%')).toBeInTheDocument()

    await act(async () => {
      resolveImport({ success: true, topicsCount: 1, messagesCount: 2 })
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // The dialog traps focus, so a Details entry that only lives in the global toast is unreachable by keyboard.
  it('keeps a rejected import open with a keyboard-reachable Details entry inside the dialog', async () => {
    const user = userEvent.setup()
    mocks.openFile.mockResolvedValue({ content: '[]' })
    mocks.importConversations.mockResolvedValue({
      error: 'database unavailable',
      messagesCount: 0,
      success: false,
      topicsCount: 0
    })

    render(<PopupHost />)
    act(() => {
      void ImportPopup.show({ source: 'chatgpt' })
    })

    await user.click(await screen.findByRole('button', { name: 'import.chatgpt.button' }))

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('import.chatgpt.error.unknown')
    const details = within(dialog).getByRole('button', { name: 'common.detail' })
    for (let step = 0; step < 10 && document.activeElement !== details; step++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    expect(details).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(mocks.openDetail).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ message: 'database unavailable', operation: 'import.chatgpt' }),
          localizedErrorMessage: 'import.chatgpt.error.unknown'
        })
      )
    )
    // The service only returned text, so no renderer-side stack may be fabricated for it.
    expect(mocks.openDetail.mock.calls[0][0].context).not.toHaveProperty('stack')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps a thrown file-open error and still closes the dialog', async () => {
    const user = userEvent.setup()
    const openError = new Error('EACCES: permission denied')
    mocks.openFile.mockRejectedValue(openError)

    render(<PopupHost />)
    act(() => {
      void ImportPopup.show({ source: 'chatgpt' })
    })

    await user.click(await screen.findByRole('button', { name: 'import.chatgpt.button' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: openError,
          data: expect.objectContaining({
            errorContext: expect.objectContaining({
              message: 'EACCES: permission denied',
              operation: 'import.chatgpt',
              source: 'settings.import'
            }),
            localizedErrorMessage: 'import.chatgpt.error.unknown'
          }),
          title: 'import.chatgpt.error.unknown'
        })
      )
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.importConversations).not.toHaveBeenCalled()
  })
})

// A successful import must refresh already mounted lists without reloading the window.
it('shows imported assistants and conversations after completion', async () => {
  let imported = false
  MockDataApiService.dataApiService.get.mockImplementation(async (path) => ({
    items: imported
      ? [{ id: 'imported', name: path === '/assistants' ? 'ChatGPT Import' : 'Imported conversation' }]
      : [],
    total: imported ? 1 : 0
  }))
  mocks.openFile.mockResolvedValueOnce({ content: '[]' })
  mocks.importConversations.mockImplementationOnce(async () => {
    imported = true
    return { success: true, topicsCount: 1, messagesCount: 2 }
  })
  function Lists() {
    const assistants = useQuery('/assistants', { query: { limit: 500 } })
    const topics = useQuery('/topics')
    return (
      <>
        <div>
          {assistants.data
            ? assistants.data.items.map((item) => item.name).join(', ') || 'No assistants'
            : 'Loading assistants'}
        </div>
        <div>
          {topics.data
            ? topics.data.items.map((item) => item.name).join(', ') || 'No conversations'
            : 'Loading conversations'}
        </div>
      </>
    )
  }
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Lists />
      <PopupHost />
    </SWRConfig>
  )
  await screen.findByText('No assistants')
  await screen.findByText('No conversations')
  act(() => {
    void ImportPopup.show({ source: 'chatgpt' })
  })
  await userEvent.setup().click(await screen.findByRole('button', { name: 'import.chatgpt.button' }))
  await screen.findByText('ChatGPT Import')
  await screen.findByText('Imported conversation')
})
