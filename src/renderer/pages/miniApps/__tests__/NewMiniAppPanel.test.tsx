import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewMiniAppPanel from '../NewMiniAppPanel'

const mocks = vi.hoisted(() => ({
  miniApps: [],
  disabled: [],
  pinned: [],
  createCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  updateCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  compressImage: vi.fn(),
  convertToBase64: vi.fn(),
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

vi.mock('@renderer/components/icons/LogoAvatar', () => ({
  default: ({ logo }: { logo: unknown }) => <img alt="miniapp-logo-preview" data-logo={String(logo)} />
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogo: (logo?: string) => (logo === 'application' ? 'application-icon' : undefined)
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'generated-id'
}))

vi.mock('@renderer/utils/image', () => ({
  compressImage: mocks.compressImage,
  convertToBase64: mocks.convertToBase64
}))

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
  mocks.compressImage.mockReset()
  mocks.convertToBase64.mockReset()
  mocks.compressImage.mockImplementation(async (file: File) => file)
  mocks.convertToBase64.mockResolvedValue('data:image/png;base64,compressed')
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
        logo: 'application'
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
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute(
        'data-logo',
        'data:image/png;base64,compressed'
      )
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
        logo: 'data:image/png;base64,compressed'
      })
    })
  })

  it('compresses and shows the selected logo file immediately', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    })

    await waitFor(() => {
      expect(mocks.compressImage).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ maxSizeMB: 0.25, maxWidthOrHeight: 256 })
      )
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute(
        'data-logo',
        'data:image/png;base64,compressed'
      )
      expect(window.toast.success).not.toHaveBeenCalled()
    })
  })

  it('disables saving while the selected logo file is still processing', async () => {
    let resolveLogo: (value: string) => void = () => {}
    mocks.convertToBase64.mockImplementationOnce(
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
    await waitFor(() => expect(mocks.convertToBase64).toHaveBeenCalledTimes(1))

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect(saveBtn).toBeDisabled()
    expect(mocks.createCustomMiniApp).not.toHaveBeenCalled()

    await act(async () => {
      resolveLogo('data:image/png;base64,late')
    })

    await waitFor(() => expect(saveBtn).not.toBeDisabled())
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'generated-id',
        name: 'My App',
        url: 'https://my.app',
        logo: 'data:image/png;base64,late'
      })
    })
  })

  it('rejects selected logo files that remain too large after processing', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    mocks.convertToBase64.mockResolvedValueOnce(`data:image/png;base64,${'a'.repeat(1024 * 1024)}`)

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
    mocks.convertToBase64.mockImplementationOnce(
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
    await waitFor(() => expect(mocks.convertToBase64).toHaveBeenCalledTimes(1))

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
      resolveLogo('data:image/png;base64,late')
    })

    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'https://b.app/logo.png')
  })

  it('does not show upload errors after the panel closes', async () => {
    let rejectLogo: (error: Error) => void = () => {}
    mocks.convertToBase64.mockImplementationOnce(
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
    await waitFor(() => expect(mocks.convertToBase64).toHaveBeenCalledTimes(1))

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
