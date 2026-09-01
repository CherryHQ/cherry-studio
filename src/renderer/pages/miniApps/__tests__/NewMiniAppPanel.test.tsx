import { toast } from '@renderer/services/toast'
import type * as ImageUtils from '@renderer/utils/image'
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
  refreshCustomMiniApp: vi.fn().mockResolvedValue(undefined),
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
    updateCustomMiniApp: mocks.updateCustomMiniApp,
    refreshCustomMiniApp: mocks.refreshCustomMiniApp
  })
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => ['/files', vi.fn()]
}))

vi.mock('@renderer/components/icons/MiniAppLogoAvatar', () => ({
  default: ({ logo }: { logo: unknown }) => <img alt="miniapp-logo-preview" data-logo={String(logo)} />
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'generated-id'
}))

vi.mock('@cherrystudio/ui', async () => {
  // Stateful, unlike the global flattened stand-in: the package tab mounts its content
  // only when chosen, so switching has to actually switch.
  const React = await import('react')
  const TabsContext = React.createContext<{ value?: string; onValueChange?: (value: string) => void }>({})
  return {
    Tabs: ({
      value,
      onValueChange,
      children
    }: React.PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => (
      <TabsContext value={{ value, onValueChange }}>{children}</TabsContext>
    ),
    TabsList: ({ children }: React.PropsWithChildren) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children }: React.PropsWithChildren<{ value: string }>) => {
      const ctx = React.use(TabsContext)
      return (
        <button type="button" role="tab" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    TabsContent: ({ value, children }: React.PropsWithChildren<{ value: string }>) => {
      const ctx = React.use(TabsContext)
      return ctx.value === value ? <div role="tabpanel">{children}</div> : null
    },
    Alert: ({ message }: { message: string }) => <div role="alert">{message}</div>,
    InputGroup: ({ children }: React.PropsWithChildren) => <div role="group">{children}</div>,
    InputGroupInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    InputGroupAddon: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    InputGroupButton: ({
      children,
      onClick,
      disabled
    }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
      <label htmlFor={htmlFor}>{children}</label>
    ),
    Button: ({
      children,
      onClick,
      disabled
    }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
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
  }
})

vi.mock('react-i18next', () => ({
  // `i18n` too: the package tab's content resolves the manifest's locale table against it.
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US', resolvedLanguage: 'en-US' } })
}))

// This suite mocks react-i18next without initReactI18next, so the shared setup's
// real i18n init is skipped — stub the resolver `checkEntityImageSize` reaches.
vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

// Canvas isn't available in jsdom; stub the renderer normalize step to fixed bytes.
vi.mock('@renderer/utils/image', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageUtils>()),
  prepareEntityImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3]))
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  mocks.dialogOnOpenChange = undefined
  mocks.createCustomMiniApp.mockClear()
  mocks.updateCustomMiniApp.mockClear()
  mocks.refreshCustomMiniApp.mockClear()
  mocks.refreshCustomMiniApp.mockResolvedValue(undefined)
  mocks.ipcRequest.mockReset()
  mocks.ipcRequest.mockResolvedValue(undefined)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  // jsdom has no object-URL impl nor File.arrayBuffer; stub both so the staged
  // upload preview + on-save byte read run.
  URL.createObjectURL = vi.fn(() => 'blob:miniapp-logo')
  URL.revokeObjectURL = vi.fn()
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = async function () {
      return new Uint8Array([1, 2, 3]).buffer
    }
  }
})

function fillRequiredFields(name = 'My App', url = 'https://my.app') {
  fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
    target: { value: name }
  })
  fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
    target: { value: url }
  })
}

function pickLogoFile(container: HTMLElement, file = new File(['avatar'], 'avatar.png', { type: 'image/png' })) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('Logo file input not found')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('NewMiniAppPanel', () => {
  it('save button is disabled when required fields are empty', () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses separate titles for creating and editing custom mini apps', () => {
    const { rerender } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    expect(screen.getByText('miniApp.add.title')).toBeInTheDocument()

    rerender(
      <NewMiniAppPanel
        open={true}
        app={{
          kind: 'site',
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

  it('offers a website tab and a package tab when creating, and no tabs when editing', () => {
    const { rerender } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    // Website first, as before: the save button belongs to that form.
    expect(screen.getByRole('button', { name: /common\.save/ })).toBeInTheDocument()
    expect(screen.queryByText('miniApp.add.site_description')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'miniApp.add.tab_app' }))
    // The package tab IS the install panel's picker — one dialog, not a second entry.
    expect(screen.getByText('miniApp.add.app_description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'miniApp.install.choose_file' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.save/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add.developer_docs' }))
    expect(mocks.ipcRequest).toHaveBeenCalledWith(
      'system.shell.open_website',
      'https://github.com/CherryHQ/cherry-studio-miniapps'
    )

    rerender(
      <NewMiniAppPanel
        open={true}
        app={{
          kind: 'site',
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
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('button', { name: /common\.save/ })).toBeInTheDocument()
  })

  it('submits with the trimmed form values', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fillRequiredFields('  My App  ', '  https://my.app  ')

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
    fillRequiredFields('My App', 'not a url')

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    expect(toast.error).toHaveBeenCalledWith('settings.miniApps.custom.url_invalid')
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
          kind: 'site',
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
    fillRequiredFields('New App', 'https://new.app')

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.updateCustomMiniApp).toHaveBeenCalledWith('custom-app', {
        name: 'New App',
        url: 'https://new.app'
      })
      expect(mocks.createCustomMiniApp).not.toHaveBeenCalled()
    })
  })

  it('previews an existing uploaded logo from its main-resolved logoSrc', () => {
    render(
      <NewMiniAppPanel
        open={true}
        app={{
          kind: 'site',
          appId: 'custom-app',
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: 'a0',
          name: 'Old App',
          url: 'https://old.app',
          logoSrc: `file:///files/${STORED_ID}.webp`
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', `file:///files/${STORED_ID}.webp`)
  })

  it('uploads a replacement logo via mini_app.settings.set_logo when editing', async () => {
    const { container } = render(
      <NewMiniAppPanel
        open={true}
        app={{
          kind: 'site',
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

    pickLogoFile(container)

    await waitFor(() => {
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'blob:miniapp-logo')
    })

    fillRequiredFields('New App', 'https://new.app')
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.updateCustomMiniApp).toHaveBeenCalledTimes(1)
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'mini_app.settings.set_logo',
        expect.objectContaining({ appId: 'custom-app', image: expect.objectContaining({ kind: 'image' }) })
      )
      expect(mocks.refreshCustomMiniApp).toHaveBeenCalledWith('custom-app')
    })
  })

  it('previews the selected logo file immediately without creating a file', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    pickLogoFile(container)

    await waitFor(() => {
      expect(screen.getByAltText('miniapp-logo-preview')).toHaveAttribute('data-logo', 'blob:miniapp-logo')
    })
    // Bytes are uploaded only on save, not on pick.
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('rejects an oversize logo at pick time without staging a preview', () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    pickLogoFile(container, file)

    expect(vi.mocked(toast.error)).toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('creates the app with the default logo then uploads the image via mini_app.settings.set_logo', async () => {
    const { container } = render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fillRequiredFields()
    pickLogoFile(container)

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'mini_app.settings.set_logo',
        expect.objectContaining({ appId: 'generated-id', image: expect.objectContaining({ kind: 'image' }) })
      )
      expect(mocks.refreshCustomMiniApp).toHaveBeenCalledWith('generated-id')
    })
  })

  it('surfaces a logo-specific toast and closes the dialog when the set-logo command fails on save', async () => {
    mocks.ipcRequest.mockRejectedValueOnce(new Error('set logo failed'))
    const onClose = vi.fn()

    const { container } = render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fillRequiredFields()
    pickLogoFile(container)
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      // The app saved; only the logo upload failed → a logo-specific message.
      expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
      expect(mocks.refreshCustomMiniApp).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('settings.miniApps.custom.logo_upload_error')
    })
    // The row is saved, so the dialog closes (no re-submittable create state that
    // would mint a fresh appId and insert a duplicate row) and the generic
    // success toast is suppressed in favor of the logo-specific error.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
