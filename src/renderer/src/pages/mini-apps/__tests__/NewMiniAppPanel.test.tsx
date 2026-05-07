import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewMiniAppPanel from '../NewMiniAppPanel'

const mocks = vi.hoisted(() => ({
  miniapps: [],
  disabled: [],
  pinned: [],
  createCustomMiniApp: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniapps: mocks.miniapps,
    disabled: mocks.disabled,
    pinned: mocks.pinned,
    createCustomMiniApp: mocks.createCustomMiniApp
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    id,
    value,
    onChange,
    placeholder
  }: {
    id?: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
  Field: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  PageSidePanel: ({
    open,
    children,
    header,
    footer
  }: React.PropsWithChildren<{ open: boolean; header?: React.ReactNode; footer?: React.ReactNode }>) =>
    open ? (
      <div data-testid="panel">
        <div data-testid="panel-header">{header}</div>
        <div data-testid="panel-body">{children}</div>
        {footer && <div data-testid="panel-footer">{footer}</div>}
      </div>
    ) : null
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// window.toast — used in success/error paths
beforeEach(() => {
  mocks.createCustomMiniApp.mockClear()
  ;(window as unknown as { toast: { success: () => void; error: () => void; info: () => void } }).toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
})

describe('NewMiniAppPanel', () => {
  it('renders nothing when closed', () => {
    render(<NewMiniAppPanel open={false} onClose={vi.fn()} />)
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('save button is disabled when required fields are empty', () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits with the trimmed form values', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.id_placeholder'), {
      target: { value: '  custom-app  ' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    fireEvent.click(saveBtn)

    // microtask drain so the async submit resolves
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
    expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
      appId: 'custom-app',
      name: 'My App',
      url: 'https://my.app',
      logo: 'application',
      bordered: false,
      supportedRegions: ['CN', 'Global']
    })
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
