import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import type React from 'react'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
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
    DialogContent: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="dialog-content" {...props}>
        {children}
      </div>
    ),
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

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/services/ImageStorage', () => ({
  default: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('@renderer/utils', () => ({
  compressImage: vi.fn(async (file: File) => file),
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

async function renderUserPopup() {
  const { default: UserPopup } = await import('../UserPopup')

  void UserPopup.show()
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode

  render(<>{rendered}</>)
}

describe('UserPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('renders image avatars with object-cover cropping', async () => {
    const avatar = 'file:///tmp/wide-avatar.png'
    MockUseCacheUtils.setCacheValue('app.user.avatar', avatar)

    await renderUserPopup()

    expect(screen.getByTestId('avatar-image')).toHaveClass('object-cover')
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', avatar)
  })
})
