import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewMiniAppPanel from '../NewMiniAppPanel'

const STORED_ID = '0190f3c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f'

const mocks = vi.hoisted(() => ({
  miniApps: [],
  disabled: [],
  pinned: [],
  createCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  updateCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  ipcRequest: vi.fn().mockResolvedValue(undefined),
  dialogOnOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: any[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    disabled: mocks.disabled,
    pinned: mocks.pinned,
    createCustomMiniApp: mocks.createCustomMiniApp,
    updateCustomMiniApp: mocks.updateCustomMiniApp
  })
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => ['/files', vi.fn()]
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: ({ logo }: { logo: unknown }) => <img alt="miniapp-logo-preview" data-logo={String(logo)} />
}))

vi.mock('@renderer/components/Icons/miniAppsLogo', () => ({
  getMiniAppsLogo: (logo?: string) => (logo === 'application' ? 'application-icon' : undefined)
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'generated-id'
}))

vi.mock('@renderer/utils/storedImage', () => {
  // Re-implement the pure resolver so the suite doesn't pull the real module's
  // deps. A `file:<id>` ref resolves to the on-disk WebP; everything else
  // passes through.
  return {
    resolveStoredImageSrc: (value?: string | null, filesPath?: string) => {
      if (!value) return undefined
      if (value.startsWith('file:') && !value.startsWith('file://')) {
        if (!filesPath) return undefined
        return `file://${filesPath}/${value.slice('file:'.length)}.webp`
      }
      return value
    }
  }
})

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    disabled
  }: {
    id?: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    disabled?: boolean
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />,
  Field: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Dialog: ({
    open,
    children,
    onOpenChange
  }: React.PropsWithChildren<{ open: boolean; onOpenChange?: (open: boolean) => void }>) => {
    mocks.dialogOnOpenChange = onOpenChange
    return open ? <>{children}</> : null
  },
  DialogContent: ({ children }: React.PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogClose: ({ children }: React.PropsWithChildren) => (
    <div onClick={() => mocks.dialogOnOpenChange?.(false)}>{children}</div>
  ),
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// window.toast — used in success/error paths
beforeEach(() => {
  mocks.dialogOnOpenChange = undefined
  mocks.createCustomMiniApp.mockClear()
  mocks.updateCustomMiniApp.mockClear()
  mocks.ipcRequest.mockReset()
  mocks.ipcRequest.mockResolvedValue(undefined)
  // jsdom has no object-URL impl nor File.arrayBuffer; stub both so the staged
  // upload preview + on-save byte read run.
  URL.createObjectURL = vi.fn(() => 'blob:miniapp-logo')
  URL.revokeObjectURL = vi.fn()
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = async function () {
      return new Uint8Array([1, 2, 3]).buffer
    }
  }
  ;(window as unknown as { toast: { success: () => void; error: () => void; info: () => void } }).toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
})

describe('NewMiniAppPanel', () => {
  it('renders nothing when closed', () => {
    render(<NewMiniAppPanel open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('save button is disabled when required fields are empty', () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses separate titles for creating and editing custom mini apps', () => {
    const { rerender } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    expect(screen.getByText('settings.miniApps.custom.create_title')).toBeInTheDocument()

    rerender(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'Old App',
          url: 'https://old.app',
          logo: 'application'
        }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('settings.miniApps.custom.edit_title')).toBeInTheDocument()
  })

  it('submits with the trimmed form values', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: '  My App  ' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: '  https://my.app  ' }
    })

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'generated-id',
        name: 'My App',
        url: 'https://my.app',
        logo: { kind: 'key', key: 'application' }
      })
    })
  })

  it('rejects invalid mini app URLs before submitting', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'not a url' }
    })

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    expect(window.toast.error).toHaveBeenCalledWith('settings.miniApps.custom.url_invalid')
    expect(mocks.createCustomMiniApp).not.toHaveBeenCalled()
  })

  it('does not expose logo URL controls for new custom mini apps', () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('settings.miniApps.custom.logo_url_placeholder')).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.miniApps.custom.logo_url' })).toBeNull()
  })

  it('submits edited values for an existing custom mini app', async () => {
    render(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'Old App',
          url: 'https://old.app',
          logo: 'https://old.app/logo.png'
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByPlaceholderText('settings.miniApps.custom.id_placeholder')).toBeNull()
    expect(screen.queryByPlaceholderText('settings.miniApps.custom.logo_url_placeholder')).toBeNull()
    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'https://old.app/logo.png')
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'New App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://new.app' }
    })

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.updateCustomMiniApp).toHaveBeenCalledWith('custom-app', {
        name: 'New App',
        url: 'https://new.app'
      })
      expect(mocks.createCustomMiniApp).not.toHaveBeenCalled()
    })
  })

  it('resolves an existing stored-id logo to a file:// preview', () => {
    render(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'Old App',
          url: 'https://old.app',
          logo: `file:${STORED_ID}`
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', `file:///files/${STORED_ID}.webp`)
  })

  it('uploads a replacement logo via mini_app.set_logo when editing', async () => {
    const { container } = render(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'Old App',
          url: 'https://old.app',
          logo: 'https://old.app/logo.png'
        }}
        onClose={vi.fn()}
      />
    )

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'blob:miniapp-logo')
    })

    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'New App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://new.app' }
    })
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      // The PATCH carries only name/url; the logo upload goes through the command.
      expect(mocks.updateCustomMiniApp).toHaveBeenCalledWith('custom-app', {
        name: 'New App',
        url: 'https://new.app'
      })
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'mini_app.set_logo',
        expect.objectContaining({ appId: 'custom-app', image: expect.objectContaining({ kind: 'image' }) })
      )
    })
  })

  it('previews the selected logo file immediately without creating a file', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'blob:miniapp-logo')
    })
    // Bytes are uploaded only on save, not on pick.
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('creates the app with the default logo then uploads the image via mini_app.set_logo', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    })

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'generated-id',
        name: 'My App',
        url: 'https://my.app',
        logo: { kind: 'key', key: 'application' }
      })
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'mini_app.set_logo',
        expect.objectContaining({ appId: 'generated-id', image: expect.objectContaining({ kind: 'image' }) })
      )
    })
  })

  it('surfaces a logo-specific toast when the set-logo command fails on save', async () => {
    mocks.ipcRequest.mockRejectedValueOnce(new Error('set logo failed'))

    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    })
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      // The app saved; only the logo upload failed → a logo-specific message.
      expect(mocks.createCustomMiniApp).toHaveBeenCalled()
      expect(window.toast.error).toHaveBeenCalledWith('settings.miniApps.custom.logo_upload_error')
    })
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
