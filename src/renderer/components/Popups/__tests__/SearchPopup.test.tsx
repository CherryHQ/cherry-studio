// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactElement } from 'react'
import type * as ReactModule from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hide: vi.fn(),
  show: vi.fn()
}))

vi.mock('../../TopView', () => ({
  TopView: {
    hide: mocks.hide,
    show: mocks.show
  }
}))

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
      closeOnOverlayClick,
      overlayProps
    }: PropsWithChildren<{ closeOnOverlayClick?: boolean; overlayProps?: ComponentProps<'div'> }>) => {
      const context = React.use(DialogContext)

      return (
        <>
          <div
            data-testid="dialog-overlay"
            {...overlayProps}
            onClick={(event) => {
              overlayProps?.onClick?.(event)
              // Match the real DialogContent: the overlay only closes when closeOnOverlayClick is set.
              if (closeOnOverlayClick) {
                context?.onOpenChange?.(false)
              }
            }}
          />
          <div data-testid="dialog-content">{children}</div>
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

import SearchPopup from '../SearchPopup'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchPopup', () => {
  it('allows the search panel to autofocus the search input when opened', async () => {
    mocks.show.mockImplementation((element: ReactElement) => {
      render(element)
    })

    void SearchPopup.show()

    await waitFor(() => {
      expect(screen.getByLabelText('Search input')).toHaveFocus()
    })
  })

  it('closes when the blank overlay area is clicked', async () => {
    mocks.show.mockImplementation((element: ReactElement) => {
      render(element)
    })

    void SearchPopup.show()

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    await waitFor(() => {
      expect(screen.queryByLabelText('Search input')).not.toBeInTheDocument()
    })
  })
})
