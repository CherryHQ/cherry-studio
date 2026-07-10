// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import type * as ReactModule from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPanel', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')

  return {
    GlobalSearchPanel: () => {
      const inputRef = React.useRef<HTMLInputElement>(null)

      React.useEffect(() => {
        inputRef.current?.focus()
      }, [])

      return <input ref={inputRef} aria-label="Search input" />
    }
  }
})

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  const DialogContext = React.createContext<{ onOpenChange?: (open: boolean) => void } | null>(null)

  return {
    Dialog: ({
      children,
      open,
      onOpenChange
    }: PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) =>
      open ? (
        <DialogContext value={{ onOpenChange }}>
          <div role="dialog">{children}</div>
        </DialogContext>
      ) : null,
    DialogContent: ({
      children,
      className,
      overlayClassName,
      overlayProps
    }: PropsWithChildren<{
      className?: string
      overlayClassName?: string
      overlayProps?: ComponentProps<'div'>
    }>) => {
      const context = React.use(DialogContext)

      return (
        <>
          <div
            data-testid="dialog-overlay"
            className={overlayClassName}
            {...overlayProps}
            onClick={(event) => {
              overlayProps?.onClick?.(event)
              context?.onOpenChange?.(false)
            }}
          />
          <div data-testid="dialog-content" className={className}>
            {children}
          </div>
        </>
      )
    },
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'globalSearch.open' ? 'Open global search' : key)
  })
}))

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

import GlobalSearchPopup from '../GlobalSearchPopup'

afterEach(() => {
  // Unmount the host first so settling/removing leftover entries triggers no React
  // update on a still-mounted host (which would fire act warnings). Then drain the
  // singleton store so the next test starts empty and single-flight is cleared. Fake
  // timers fire the exit phase synchronously (no wall-clock wait).
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, {})
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('GlobalSearchPopup', () => {
  it('allows the search panel to autofocus the search input when opened', async () => {
    render(<PopupHost />)

    act(() => {
      void GlobalSearchPopup.show()
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Search input')).toHaveFocus()
    })
  })

  it('closes when the blank overlay area is clicked', async () => {
    render(<PopupHost />)

    act(() => {
      void GlobalSearchPopup.show()
    })

    await screen.findByLabelText('Search input')

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    await waitFor(() => {
      expect(screen.queryByLabelText('Search input')).not.toBeInTheDocument()
    })
  })

  it('renders above chat shell overlays', async () => {
    render(<PopupHost />)

    act(() => {
      void GlobalSearchPopup.show()
    })

    const overlay = await screen.findByTestId('dialog-overlay')
    expect(overlay).toHaveClass('z-1001')
    expect(screen.getByTestId('dialog-content')).toHaveClass('z-1001')

    // Flush the lazy panel's Suspense resolution inside act before the test ends.
    await screen.findByLabelText('Search input')
  })
})
