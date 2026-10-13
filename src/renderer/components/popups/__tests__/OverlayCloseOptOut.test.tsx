import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactModule from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  skipBackupFile: false
}))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.skipBackupFile, vi.fn()]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n/label', () => ({
  getBackupProgressLabelKey: (stage: string) => `backup.progress.${stage}`
}))

vi.mock('@renderer/services/BackupService', () => ({
  backup: mocks.backup
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  const DialogContext = React.createContext<{ onOpenChange?: (open: boolean) => void } | null>(null)

  return {
    Button: ({
      children,
      type = 'button',
      ...props
    }: ComponentProps<'button'> & { variant?: string; danger?: boolean }) => {
      delete props.variant
      delete props.danger
      return (
        <button type={type} {...props}>
          {children}
        </button>
      )
    },
    CircularProgress: () => <div />,
    Dialog: ({
      children,
      open,
      onOpenChange
    }: PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) =>
      open ? (
        <DialogContext value={{ onOpenChange }}>
          <div>{children}</div>
        </DialogContext>
      ) : null,
    DialogContent: ({
      children,
      closeOnOverlayClick = true,
      onPointerDownOutside
    }: PropsWithChildren<{
      closeOnOverlayClick?: boolean
      onPointerDownOutside?: (event: { defaultPrevented: boolean; preventDefault: () => void }) => void
    }>) => {
      const context = React.use(DialogContext)

      return (
        <>
          <button
            type="button"
            data-testid="dialog-overlay"
            onClick={() => {
              const event = {
                defaultPrevented: false,
                preventDefault: () => {
                  event.defaultPrevented = true
                }
              }

              onPointerDownOutside?.(event)

              if (closeOnOverlayClick) {
                context?.onOpenChange?.(false)
              }
            }}
          />
          <div role="dialog">{children}</div>
        </>
      )
    },
    DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
    DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
  }
})

import BackupPopup from '@renderer/pages/settings/DataSettings/BackupPopup'

import ContentPopup from '../ContentPopup'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.backup.mockResolvedValue(undefined)
  mocks.skipBackupFile = false
  Object.assign(window, {
    electron: {
      ipcRenderer: {
        on: vi.fn(() => vi.fn())
      }
    }
  })
})

afterEach(() => {
  // Unmount the host first so draining the singleton store fires no React update
  // on a still-mounted host (which would warn), then settle + flush the exit timers
  // so the next test starts from an empty store. Fake timers fire the exit phase
  // synchronously (no wall-clock wait).
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, {})
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('popup overlay close opt-out', () => {
  it('keeps ContentPopup open when maskClosable is false', async () => {
    render(<PopupHost />)

    act(() => {
      void ContentPopup.show({
        content: 'Non dismissable content',
        maskClosable: false,
        title: 'Non dismissable'
      })
    })

    await screen.findByText('Non dismissable content')

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    // The overlay click is suppressed, so the popup stays on screen.
    expect(screen.getByText('Non dismissable content')).toBeInTheDocument()
  })

  it('keeps BackupPopup open when clicking the overlay', async () => {
    render(<PopupHost />)

    act(() => {
      void BackupPopup.show()
    })

    await screen.findByText('backup.content')

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    expect(screen.getByText('backup.content')).toBeInTheDocument()
  })
})

describe('BackupPopup submission', () => {
  it('forces a full backup without changing the saved slim-backup preference', async () => {
    const user = userEvent.setup()
    mocks.skipBackupFile = true
    render(<PopupHost />)
    act(() => {
      void BackupPopup.show({ forceFullBackup: true })
    })

    await user.click(await screen.findByRole('button', { name: 'backup.confirm.button' }))

    expect(mocks.backup).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('keeps the popup open and shows a localized error when active writers block backup', async () => {
    const user = userEvent.setup()
    let rejectBackup!: (error: Error) => void
    mocks.backup.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectBackup = reject
        })
    )

    render(<PopupHost />)
    act(() => {
      void BackupPopup.show()
    })

    const submitButton = await screen.findByRole('button', { name: 'backup.confirm.button' })
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    await user.click(submitButton)
    expect(mocks.backup).toHaveBeenCalledOnce()

    await act(async () => {
      rejectBackup(new Error(`Error invoking remote method: ${BACKUP_ACTIVE_WRITERS_ERROR_CODE}`))
    })

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('backup.error.active_data_writers')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(submitButton).toBeEnabled()
  })
})
