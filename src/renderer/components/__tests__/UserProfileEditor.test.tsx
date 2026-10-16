import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ImageUtils from '@renderer/utils/image'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(async (): Promise<unknown> => undefined)
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
    Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button type="button" aria-busy={loading || undefined} disabled={loading || undefined} {...props}>
        {children}
      </button>
    ),
    ColFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="col-flex" {...props}>
        {children}
      </div>
    ),
    EmojiAvatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="emoji-avatar" {...props}>
        {children}
      </div>
    ),
    Input: (props: { [key: string]: unknown }) => <input {...props} />,
    Popover: ({
      children,
      onOpenChange,
      open
    }: {
      children?: ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => <PopoverContext value={{ open: Boolean(open), onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const context = React.use(PopoverContext)
      return context.open ? <div data-testid="popover-content">{children}</div> : null
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const context = React.use(PopoverContext)
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
    ),
    Tooltip: ({ children }: { children?: ReactNode }) => children
  }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@renderer/utils/naming', () => ({
  isEmoji: (value: string) => value === '🙂'
}))

vi.mock('../EmojiPicker', () => ({
  EmojiPicker: () => <div data-testid="emoji-picker" />
}))

vi.mock('@renderer/utils/image', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageUtils>()),
  prepareEntityImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3]))
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { UserProfileEditor } from '../UserProfileEditor'

describe('UserProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('shows the local nickname as text until edit is requested, then saves a trimmed draft', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Yinsen')
    render(<UserProfileEditor />)

    expect(screen.getByText('Yinsen')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'settings.general.user_name.label' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.general.user_name.label' }))
    const input = screen.getByRole('textbox', { name: 'settings.general.user_name.label' })
    await user.clear(input)
    await user.type(input, '  Sora  ')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'settings.general.user_name.label' })).not.toBeInTheDocument()
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.user.name')).toBe('Sora')
    expect(screen.getByText('Sora')).toBeVisible()
  })

  it('discards an edited nickname when cancelled', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Yinsen')
    render(<UserProfileEditor />)

    await user.click(screen.getByRole('button', { name: 'settings.general.user_name.label' }))
    const input = screen.getByRole('textbox', { name: 'settings.general.user_name.label' })
    await user.clear(input)
    await user.type(input, 'Sora')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(MockUsePreferenceUtils.getPreferenceValue('app.user.name')).toBe('Yinsen')
    expect(screen.queryByRole('textbox', { name: 'settings.general.user_name.label' })).not.toBeInTheDocument()
    expect(screen.getByText('Yinsen')).toBeVisible()
  })

  it('cancels nickname editing on Escape', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Yinsen')
    render(<UserProfileEditor />)

    await user.click(screen.getByRole('button', { name: 'settings.general.user_name.label' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: 'settings.general.user_name.label' })).not.toBeInTheDocument()
    expect(screen.getByText('Yinsen')).toBeVisible()
  })

  it('accepts and uploads a WebP avatar as raw bytes via profile.set_avatar', async () => {
    render(<UserProfileEditor />)

    fireEvent.click(screen.getByTestId('popover-trigger'))

    const file = Object.assign(new File(['webp'], 'a.webp', { type: 'image/webp' }), {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })
    const input = screen.getByTestId('popover-content').querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept.split(/,\s*/)).toContain('image/webp')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('profile.set_avatar', {
        kind: 'image',
        data: expect.any(Uint8Array)
      })
    })
  })

  it('rejects an oversize avatar at pick time without calling profile.set_avatar', async () => {
    render(<UserProfileEditor />)

    fireEvent.click(screen.getByTestId('popover-trigger'))

    const file = Object.assign(new File(['png'], 'a.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    const input = screen.getByTestId('popover-content').querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
        'profile.set_avatar',
        expect.objectContaining({ kind: 'image' })
      )
    })
  })

  it('exposes avatar and nickname controls for the personal information page', () => {
    render(<UserProfileEditor />)
    expect(screen.getByRole('button', { name: 'common.avatar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.general.user_name.label' })).toBeInTheDocument()
  })
})
