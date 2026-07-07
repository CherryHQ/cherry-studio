import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactModule from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  backupToLanTransfer: vi.fn()
}))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
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
  backup: mocks.backup,
  backupToLanTransfer: mocks.backupToLanTransfer
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

import BackupPopup from '../BackupPopup'
import GeneralPopup from '../GeneralPopup'

beforeEach(() => {
  vi.clearAllMocks()
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
  it('keeps GeneralPopup open when maskClosable is false', async () => {
    const afterClose = vi.fn()
    render(<PopupHost />)

    act(() => {
      void GeneralPopup.show({
        afterClose,
        content: 'Non dismissable content',
        maskClosable: false,
        title: 'Non dismissable'
      })
    })

    await screen.findByText('Non dismissable content')

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    // The overlay click is suppressed, so the popup never settles: afterClose stays
    // uncalled and the content is still on screen.
    expect(afterClose).not.toHaveBeenCalled()
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
