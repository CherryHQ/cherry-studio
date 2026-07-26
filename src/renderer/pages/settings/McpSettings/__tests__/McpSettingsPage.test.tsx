import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import McpSettingsPage from '../McpSettingsPage'

vi.mock('@cherrystudio/ui', () => ({
  Flex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuDivider: () => <hr />,
  MenuItem: ({ icon, label }: { icon?: ReactNode; label: string }) => (
    <button type="button">
      {icon}
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  McpLogo: () => <span />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useLocation: () => ({ pathname: '/settings/mcp/builtin' }),
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })
}))

vi.mock('../providers/config', () => ({
  getMcpProviderLogo: vi.fn(),
  getProviderDisplayName: vi.fn(),
  providers: []
}))

describe('McpSettingsPage', () => {
  it('uses the server icon for the built-in servers menu item', () => {
    render(<McpSettingsPage />)

    const builtInServersItem = screen.getByRole('button', { name: 'Built-in Servers' })
    expect(builtInServersItem.querySelector('.lucide-server')).toBeInTheDocument()
  })
})
