import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const mocks = vi.hoisted(() => ({
  importConversations: vi.fn(),
  openFile: vi.fn()
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/services/import', () => ({
  importService: {
    importConversations: mocks.importConversations
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ description, message }: { description?: ReactNode; message?: ReactNode }) => (
    <div role="status">
      {message}
      {description}
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
  Dialog: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (open ? children : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <footer>{children}</footer>,
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>
}))

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
})
