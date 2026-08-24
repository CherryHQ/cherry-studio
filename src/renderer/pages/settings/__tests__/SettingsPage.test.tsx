import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEventHandler, KeyboardEventHandler, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '../SettingsPage'

const { isMacTransparentWindowMock, navigateMock } = vi.hoisted(() => ({
  isMacTransparentWindowMock: vi.fn(),
  navigateMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  MenuDivider: () => <hr />,
  MenuItem: ({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ className, title }: { className?: string; title: string }) => (
    <header className={className}>{title}</header>
  ),
  SearchInput: ({
    value,
    onChange,
    onKeyDown,
    onClear,
    clearLabel,
    ...props
  }: {
    value: string
    onChange: ChangeEventHandler<HTMLInputElement>
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>
    onClear?: () => void
    clearLabel?: string
    'aria-label'?: string
  }) => (
    <div>
      <input type="search" value={value} onChange={onChange} onKeyDown={onKeyDown} {...props} />
      {value && onClear && (
        <button type="button" aria-label={clearLabel} onClick={onClear}>
          clear
        </button>
      )}
    </div>
  )
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => isMacTransparentWindowMock()
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useLocation: () => ({ pathname: '/settings/provider' }),
  useNavigate: () => navigateMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN',
      resolvedLanguage: 'zh-CN',
      getResourceBundle: () => enUS
    },
    t: (key: string) => zhCN[key as keyof typeof zhCN] ?? enUS[key as keyof typeof enUS] ?? key
  })
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    isMacTransparentWindowMock.mockReturnValue(false)
    navigateMock.mockReset()
  })

  it('finds a localized setting by pinyin and navigates to its owning page', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    const searchbox = screen.getByRole('searchbox', { name: '搜索' })
    await user.type(searchbox, 'xitongdaili')

    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '模型服务' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '通用' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/general' })
    expect(searchbox).toHaveValue('')
    expect(screen.getByRole('button', { name: '模型服务' })).toBeInTheDocument()
  })

  it('announces an empty result and restores navigation with Escape', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    const searchbox = screen.getByRole('searchbox', { name: '搜索' })
    await user.type(searchbox, 'no-such-setting-value')

    expect(screen.getByRole('status')).toHaveTextContent('无结果')

    await user.keyboard('{Escape}')

    expect(searchbox).toHaveValue('')
    expect(screen.getByRole('button', { name: '模型服务' })).toBeInTheDocument()
  })
})
