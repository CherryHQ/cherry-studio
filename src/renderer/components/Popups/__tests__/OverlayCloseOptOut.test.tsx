import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactModule from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  backupToLanTransfer: vi.fn(),
  hide: vi.fn(),
  show: vi.fn()
}))

vi.mock('../../TopView/TopView', () => ({
  TopView: {
    hide: mocks.hide,
    show: mocks.show
  }
}))

vi.mock('@renderer/components/TopView/TopView', () => ({
  TopView: {
    hide: mocks.hide,
    show: mocks.show
  }
}))

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

afterEach(cleanup)

describe('popup overlay close opt-out', () => {
  it('keeps GeneralPopup open when maskClosable is false', () => {
    const afterClose = vi.fn()
    mocks.show.mockImplementation((element: ReactNode) => render(<>{element}</>))

    void GeneralPopup.show({
      afterClose,
      content: 'Non dismissable content',
      maskClosable: false,
      title: 'Non dismissable'
    })

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    expect(afterClose).not.toHaveBeenCalled()
    expect(mocks.hide).not.toHaveBeenCalled()
  })

  it('keeps BackupPopup open when clicking the overlay', () => {
    mocks.show.mockImplementation((element: ReactNode) => render(<>{element}</>))

    void BackupPopup.show()

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    expect(mocks.hide).not.toHaveBeenCalled()
  })
})
