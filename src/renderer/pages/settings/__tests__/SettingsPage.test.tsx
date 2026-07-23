import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '../SettingsPage'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', () => ({
  MenuDivider: () => <hr data-testid="menu-divider" />,
  MenuItem: ({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick?: () => void }) => (
    <button type="button" data-testid="menu-item" onClick={onClick}>
      {icon}
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ className, title }: { className?: string; title: string }) => (
    <header className={className}>{title}</header>
  )
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useLocation: () => ({ pathname: '/settings/provider' }),
  useNavigate: () => navigateMock
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.settings.toolsMcp.mcp.tab': 'MCP',
        'selection.name': '划词助手',
        'settings.channels.title': '频道',
        'settings.dependencies.title': '环境依赖',
        'settings.dependencies.localModels.title': '本地模型',
        'settings.menuGroups.automation': '效率',
        'settings.menuGroups.capabilities': '工具',
        'settings.menuGroups.personal': '偏好',
        'settings.menuGroups.quickAccess': '快捷入口',
        'settings.model': '默认模型',
        'settings.quickAssistant.title': '快捷助手',
        'settings.scheduledTasks.title': '定时任务',
        'settings.shortcuts.title': '快捷键',
        'settings.skills.title': '技能',
        'settings.system.title': '系统',
        'settings.tool.file_processing.features.image_to_text.title': 'OCR',
        'settings.tool.file_processing.features.document_to_markdown.title': '文档处理'
      })[key] ?? key
  })
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset()
  })

  it('places local models directly below the default model', () => {
    render(<SettingsPage />)

    expect(screen.getByText('title.settings').closest('header')).toHaveClass('mb-1')
    expect(screen.getByText('偏好')).toBeInTheDocument()

    const defaultModelItem = screen.getByRole('button', { name: '默认模型' })
    const localModelsItem = screen.getByRole('button', { name: '本地模型' })

    expect(defaultModelItem.nextElementSibling).toBe(localModelsItem)
    expect(localModelsItem.querySelector('.lucide-file-box')).toBeInTheDocument()

    fireEvent.click(localModelsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/local-models' })
  })

  it('keeps document processing and OCR together in tools and places dependencies below system', () => {
    render(<SettingsPage />)

    expect(screen.getByText('工具')).toBeInTheDocument()

    const documentProcessingItem = screen.getByRole('button', { name: '文档处理' })
    const ocrItem = screen.getByRole('button', { name: 'OCR' })
    expect(documentProcessingItem.nextElementSibling).toBe(ocrItem)
    expect(ocrItem.nextElementSibling).toHaveAttribute('data-testid', 'menu-divider')

    const systemItem = screen.getByRole('button', { name: '系统' })
    const dependenciesItem = screen.getByRole('button', { name: '环境依赖' })
    expect(systemItem.nextElementSibling).toBe(dependenciesItem)
    expect(dependenciesItem.querySelector('.lucide-terminal')).toBeInTheDocument()

    fireEvent.click(dependenciesItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/dependencies' })
  })

  it('places Skills directly below MCP and opens the Skills settings page', () => {
    render(<SettingsPage />)

    const mcpItem = screen.getByText('MCP').closest('button')
    const skillsItem = screen.getByRole('button', { name: '技能' })

    expect(mcpItem).not.toBeNull()
    expect(mcpItem?.nextElementSibling).toBe(skillsItem)
    expect(skillsItem.querySelector('.lucide-tool-case')).toBeInTheDocument()

    fireEvent.click(skillsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/skills' })
  })

  it('merges quick access into efficiency and places both assistants last', () => {
    render(<SettingsPage />)

    expect(screen.getByText('效率')).toBeInTheDocument()
    expect(screen.queryByText('快捷入口')).not.toBeInTheDocument()

    const efficiencyItems = ['频道', '定时任务', '快捷键', '快捷助手', '划词助手'].map((name) =>
      screen.getByRole('button', { name })
    )
    const menuItems = screen.getAllByTestId('menu-item')
    const efficiencyStart = menuItems.indexOf(efficiencyItems[0])

    expect(menuItems.slice(efficiencyStart, efficiencyStart + efficiencyItems.length)).toEqual(efficiencyItems)
    expect(efficiencyItems.at(-1)?.nextElementSibling).toHaveAttribute('data-testid', 'menu-divider')
  })
})
