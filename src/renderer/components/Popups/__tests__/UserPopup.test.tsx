import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen } from '@testing-library/react'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    PopoverContent: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
      const context = React.use(PopoverContext)

      return context.open ? (
        <div data-testid="popover-content" {...props}>
          {children}
        </div>
      ) : null
    },
    PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => children,
    RowFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="row-flex" {...props}>
        {children}
      </div>
    )
  }
})

vi.mock('@cherrystudio/ui/fluent-emoji', () => ({
  EmojiAvatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="emoji-avatar" {...props}>
      {children}
    </div>
  )
}))

// This suite renders the real popup through the store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/services/ImageStorage', () => ({
  default: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('@renderer/utils/image', () => ({
  fileToAvatarDataUrl: vi.fn(async () => 'data:image/png;base64,avatar')
}))

vi.mock('@renderer/utils/naming', () => ({
  isEmoji: (value: string) => value === '🙂'
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
    MockUseCacheUtils.resetMocks()
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
    MockUseCacheUtils.setCacheValue('app.user.avatar', avatar)

    showUserPopup()

    const image = await screen.findByTestId('avatar-image')
    expect(image).toHaveClass('object-cover')
    expect(image).toHaveAttribute('src', avatar)
  })
})
