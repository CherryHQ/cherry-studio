import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import type * as ImageUtils from '@renderer/utils/image'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(async () => undefined)
}))

type PopoverContextValue = {
  open: boolean
  onOpenChange?: (open: boolean) => void
}

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactType
  const PopoverContext = React.createContext<PopoverContextValue>({ open: false })

  return {
    Avatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="avatar" {...props}>
        {children}
      </div>
    ),
    AvatarImage: ({ src, ...props }: { src?: string; [key: string]: unknown }) => (
      <img data-testid="avatar-image" src={src} alt="" {...props} />
    ),
    Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Center: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="center" {...props}>
        {children}
      </div>
    ),
    ColFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="col-flex" {...props}>
        {children}
      </div>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) =>
      open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({
      children,
      closeOnOverlayClick,
      ...props
    }: {
      children?: ReactNode
      closeOnOverlayClick?: boolean
      [key: string]: unknown
    }) => {
      void closeOnOverlayClick
      return (
        <div data-testid="dialog-content" {...props}>
          {children}
        </div>
      )
    },
    DialogHeader: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="dialog-header" {...props}>
        {children}
      </div>
    ),
    DialogTitle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <h2 data-testid="dialog-title" {...props}>
        {children}
      </h2>
    ),
    EmojiAvatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="emoji-avatar" {...props}>
        {children}
      </div>
    ),
    Input: (props: { [key: string]: unknown }) => <input {...props} />,
    Popover: ({
      children,
      open = false,
      onOpenChange
    }: {
      children?: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open, onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({
      children,
      align,
      sideOffset,
      ...props
    }: {
      children?: ReactNode
      align?: string
      sideOffset?: number
      [key: string]: unknown
    }) => {
      const context = React.use(PopoverContext)
      void align
      void sideOffset

      return context.open ? (
        <div data-testid="popover-content" {...props}>
          {children}
        </div>
      ) : null
    },
    PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => {
      const context = React.use(PopoverContext)
      // The real trigger opens the popover on click; wire that here so tests can
      // reach the file-upload / emoji controls inside PopoverContent.
      return (
        <div data-testid="popover-trigger" onClick={() => context.onOpenChange?.(true)}>
          {children}
        </div>
      )
    },
    RowFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="row-flex" {...props}>
        {children}
      </div>
    )
  }
})

// This suite renders the real popup through the store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@renderer/utils/naming', () => ({
  isEmoji: (value: string) => value === '🙂'
}))

// Canvas isn't available in jsdom; stub the renderer normalize step to fixed bytes.
vi.mock('@renderer/utils/image', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageUtils>()),
  prepareEntityImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3]))
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { PopupHost } from '@renderer/components/PopupHost'

import UserPopup from '../UserPopup'

function showUserPopup() {
  render(<PopupHost />)

  // show() adds an entry to the popup store and synchronously notifies PopupHost;
  // wrap it so the resulting useSyncExternalStore re-render runs inside act().
  act(() => {
    void UserPopup.show()
  })
}

describe('UserPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    // Unmount the host before draining so settling leftover entries triggers no React
    // update on a still-mounted host, then flush the shared singleton store. Fake timers
    // fire the exit phase synchronously (no wall-clock wait).
    cleanup()
    vi.useFakeTimers()
    for (const entry of [...popupService.getSnapshot()]) {
      popupService.settle(entry.instanceId, {})
    }
    vi.advanceTimersByTime(POPUP_EXIT_MS)
    vi.useRealTimers()
  })

  it('renders image avatars with object-cover cropping', async () => {
    const avatar = 'file:///tmp/wide-avatar.png'
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', avatar)

    showUserPopup()

    const image = await screen.findByTestId('avatar-image')
    expect(image).toHaveClass('object-cover')
    expect(image).toHaveAttribute('src', avatar)
  })

  it('only customizes avatar picker popover width and padding', async () => {
    showUserPopup()

    fireEvent.click(await screen.findByTestId('popover-trigger'))

    const popoverContent = screen.getByTestId('popover-content')

    expect(popoverContent).toHaveClass('w-auto', 'p-2')
    expect(popoverContent).not.toHaveClass(
      'border',
      'border-border',
      'bg-popover',
      'text-popover-foreground',
      'shadow-lg'
    )
  })

  it('uploads an avatar as raw bytes via profile.set_avatar', async () => {
    showUserPopup()

    // Open the avatar popover to reveal the upload control + hidden file input.
    const trigger = await screen.findByTestId('popover-trigger')
    fireEvent.click(trigger)

    // jsdom's File lacks arrayBuffer(); add it so the handler can read the bytes.
    const file = Object.assign(new File(['png'], 'a.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })
    const input = screen.getByTestId('dialog-content').querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('profile.set_avatar', {
        kind: 'image',
        data: expect.any(Uint8Array)
      })
    })
  })

  it('rejects an oversize avatar at pick time without calling profile.set_avatar', async () => {
    showUserPopup()

    const trigger = await screen.findByTestId('popover-trigger')
    fireEvent.click(trigger)

    const file = Object.assign(new File(['png'], 'a.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    const input = screen.getByTestId('dialog-content').querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
        'profile.set_avatar',
        expect.objectContaining({ kind: 'image' })
      )
    })
  })
})
