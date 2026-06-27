import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewMiniAppPanel from '../NewMiniAppPanel'

const STORED_ID = '0190f3c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f'

const UPLOAD_ID = '019606a0-0000-7000-8000-0000000000aa'

const mocks = vi.hoisted(() => ({
  miniApps: [],
  disabled: [],
  pinned: [],
  createCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  updateCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  storeImageUpload: vi.fn(),
  dialogOnOpenChange: undefined as ((open: boolean) => void) | undefined
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

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: (logo?: string) => (logo === 'application' ? 'application-icon' : undefined)
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'generated-id'
}))

vi.mock('@renderer/utils/storedImage', () => {
  // Re-implement the pure resolver (the real module pulls in i18n, which isn't
  // initialized in this suite); only storeImageUpload is a spy. A `file:<id>`
  // ref resolves to the on-disk WebP; everything else passes through.
  return {
    storeImageUpload: mocks.storeImageUpload,
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
  mocks.storeImageUpload.mockReset()
  mocks.storeImageUpload.mockResolvedValue(UPLOAD_ID)
  // jsdom has no object-URL impl; stub so the upload preview path runs.
  URL.createObjectURL = vi.fn(() => 'blob:miniapp-logo')
  URL.revokeObjectURL = vi.fn()
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

  it('submits a replacement logo only after selecting a new logo file while editing', async () => {
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
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
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
      expect(mocks.updateCustomMiniApp).toHaveBeenCalledWith('custom-app', {
        name: 'New App',
        url: 'https://new.app',
        logo: { kind: 'file', fileId: UPLOAD_ID }
      })
    })
  })

  it('stores and previews the selected logo file immediately', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(mocks.storeImageUpload).toHaveBeenCalledWith(file)
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'blob:miniapp-logo')
      expect(window.toast.success).not.toHaveBeenCalled()
    })
  })

  it('submits the uploaded logo as a pre-stored file id when creating', async () => {
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
    await waitFor(() => expect(mocks.storeImageUpload).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'generated-id',
        name: 'My App',
        url: 'https://my.app',
        logo: { kind: 'file', fileId: UPLOAD_ID }
      })
    })
  })

  it('disables saving while the selected logo file is still processing', async () => {
    let resolveLogo: (value: string) => void = () => {}
    mocks.storeImageUpload.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveLogo = resolve
        })
    )

    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })
    await waitFor(() => expect(mocks.storeImageUpload).toHaveBeenCalledTimes(1))

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect(saveBtn).toBeDisabled()
    expect(mocks.createCustomMiniApp).not.toHaveBeenCalled()

    await act(async () => {
      resolveLogo(UPLOAD_ID)
    })

    await waitFor(() => expect(saveBtn).not.toBeDisabled())
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'generated-id',
        name: 'My App',
        url: 'https://my.app',
        logo: { kind: 'file', fileId: UPLOAD_ID }
      })
    })
  })

  it('surfaces a toast and keeps the default preview when processing the logo fails', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    mocks.storeImageUpload.mockRejectedValueOnce(new Error('decode failed'))

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.miniApps.custom.logo_upload_error')
    })
    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'application-icon')
  })

  it('ignores stale logo upload results after switching edited apps', async () => {
    let resolveLogo: (value: string) => void = () => {}
    mocks.storeImageUpload.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveLogo = resolve
        })
    )

    const { container, rerender } = render(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app-a',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'App A',
          url: 'https://a.app',
          logo: 'https://a.app/logo.png'
        }}
        onClose={vi.fn()}
      />
    )

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })
    await waitFor(() => expect(mocks.storeImageUpload).toHaveBeenCalledTimes(1))

    rerender(
      <NewMiniAppPanel
        open={true}
        app={{
          appId: 'custom-app-b',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a1',
          name: 'App B',
          url: 'https://b.app',
          logo: 'https://b.app/logo.png'
        }}
        onClose={vi.fn()}
      />
    )

    await act(async () => {
      resolveLogo(UPLOAD_ID)
    })

    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'https://b.app/logo.png')
  })

  it('does not show upload errors after the panel closes', async () => {
    let rejectLogo: (error: Error) => void = () => {}
    mocks.storeImageUpload.mockImplementationOnce(
      () =>
        new Promise<string>((_, reject) => {
          rejectLogo = reject
        })
    )

    const { container, rerender } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })
    await waitFor(() => expect(mocks.storeImageUpload).toHaveBeenCalledTimes(1))

    rerender(<NewMiniAppPanel open={false} onClose={vi.fn()} />)
    await act(async () => {
      rejectLogo(new Error('upload failed'))
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
