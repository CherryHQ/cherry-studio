import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '../SettingsPage'

const mocks = vi.hoisted(() => ({ isMacTransparentWindow: false }))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => mocks.isMacTransparentWindow
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="settings-outlet" />,
  useLocation: () => ({ pathname: '/settings/appearance' }),
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  MenuDivider: () => <hr />,
  MenuItem: ({ label }: { label: ReactNode }) => <button type="button">{label}</button>,
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title }: { title: ReactNode }) => <h2>{title}</h2>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/icons/GatewayIcon', () => ({ GatewayIcon: () => null }))
vi.mock('@renderer/components/icons/SvgIcon', () => ({ McpLogo: () => null }))

describe('SettingsPage background', () => {
  beforeEach(() => {
    mocks.isMacTransparentWindow = false
  })

  it('uses the semantic background token for opaque windows', () => {
    const { container } = render(<SettingsPage />)

    expect(container.firstElementChild).toHaveClass('bg-background')
    expect(container.firstElementChild).not.toHaveClass('bg-white')
  })

  it('keeps transparent macOS windows transparent', () => {
    mocks.isMacTransparentWindow = true
    const { container } = render(<SettingsPage />)

    expect(container.firstElementChild).toHaveClass('bg-transparent')
    expect(container.firstElementChild).not.toHaveClass('bg-background')
  })
})
