import { MockUseDataApiUtils, mockUsePaginatedQuery, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { HooksSettings } from '../HooksSettings'
import SettingsPage from '../SettingsPage'

const { isMacTransparentWindowMock, navigateMock } = vi.hoisted(() => ({
  isMacTransparentWindowMock: vi.fn(),
  navigateMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUi>()
  return {
    ...actual,
    // Only the unrelated system-prompt editor needs a DOM-only stand-in; Hook fields stay real.
    CodeEditor: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
      <textarea value={value} onChange={(event) => onChange?.(event.currentTarget.value)} />
    ),
    MenuDivider: () => <hr data-testid="menu-divider" />,
    MenuItem: (props: ComponentProps<typeof actual.MenuItem>) => <actual.MenuItem {...props} data-testid="menu-item" />,
    MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PageHeader: ({ title, action }: { title: string; action?: ReactNode }) => (
      <header>
        {title}
        {action}
      </header>
    ),
    SearchInput: (props: {
      value: string
      placeholder?: string
      onChange: (e: { target: { value: string } }) => void
      onKeyDown?: (e: { key: string; preventDefault: () => void }) => void
    }) => (
      <input
        data-testid="settings-search-input"
        value={props.value}
        placeholder={props.placeholder}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
      />
    )
  }
})

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => isMacTransparentWindowMock()
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useLocation: () => ({ pathname: '/settings/provider' }),
  useNavigate: () => navigateMock,
  useRouter: () => ({ history: { canGoBack: () => false, back: vi.fn() } }),
  useSearch: () => ({})
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.settings.toolsMcp.mcp.tab': 'MCP',
        'selection.name': '划词助手',
        'settings.appearance.title': '外观',
        'settings.channels.title': '频道',
        'settings.dependencies.title': '环境依赖',
        'settings.dependencies.localModels.title': '本地模型',
        'settings.general.common.title': zhCN['settings.general.common.title'],
        'settings.menuGroups.automation': '效率',
        'settings.menuGroups.capabilities': '工具',
        'settings.menuGroups.personal': '偏好',
        'settings.menuGroups.quickAccess': '快捷入口',
        'settings.menuGroups.system': '系统',
        'settings.model': '默认模型',
        'settings.prompts.title': '提示词',
        'settings.quickAssistant.title': '快捷助手',
        'settings.scheduledTasks.title': '定时任务',
        'settings.screenshot.title': '截图',
        'settings.shortcuts.title': '快捷键',
        'settings.skills.title': '技能',
        'settings.system.title': '系统',
        'settings.tool.file_processing.features.image_to_text.title': 'OCR',
        'settings.tool.file_processing.features.document_to_markdown.title': '文档处理'
      })[key] ??
      zhCN[key as keyof typeof zhCN] ??
      key
  })
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    isMacTransparentWindowMock.mockReturnValue(false)
    navigateMock.mockReset()
    MockUseDataApiUtils.mockPaginatedData('/agents', [])
  })

  it('mounts the full-width search field from the header icon only on demand', () => {
    // Off the search page: no field in the DOM, just the quiet header icon
    render(<SettingsPage />)
    expect(screen.queryByTestId('settings-search-input')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: zhCN['settings.search.placeholder'] })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: zhCN['settings.search.placeholder'] }))
    expect(screen.getByTestId('settings-search-input')).toBeInTheDocument()

    // Empty-field Escape reports collapse; the page unmounts the field again
    fireEvent.keyDown(screen.getByTestId('settings-search-input'), { key: 'Escape' })
    expect(screen.queryByTestId('settings-search-input')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: zhCN['settings.search.placeholder'] })).toBeInTheDocument()
  })

  it('places General directly above Appearance and local models directly below the default model', () => {
    const { container } = render(<SettingsPage />)

    expect(container.querySelector('[data-ui="settings.view"]')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="settings.navigation"]')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="settings.content"]')).toBeInTheDocument()
    expect(screen.getByText('偏好')).toBeInTheDocument()

    const generalItem = screen.getByRole('button', { name: '通用' })
    const appearanceItem = screen.getByRole('button', { name: '外观' })
    const defaultModelItem = screen.getByRole('button', { name: '默认模型' })
    const localModelsItem = screen.getByRole('button', { name: '本地模型' })

    expect(generalItem.nextElementSibling).toBe(appearanceItem)
    expect(defaultModelItem.nextElementSibling).toBe(localModelsItem)
    fireEvent.click(generalItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/general' })
    fireEvent.click(localModelsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/local-models' })
  })

  it('keeps document processing and OCR together in tools and dependencies in the system group', () => {
    render(<SettingsPage />)

    expect(screen.getByText('工具')).toBeInTheDocument()

    const documentProcessingItem = screen.getByRole('button', { name: '文档处理' })
    const ocrItem = screen.getByRole('button', { name: 'OCR' })
    expect(documentProcessingItem.nextElementSibling).toBe(ocrItem)
    expect(ocrItem.nextElementSibling).toHaveAttribute('data-testid', 'menu-divider')

    const dependenciesItem = screen.getByRole('button', { name: '环境依赖' })
    expect(screen.queryByRole('button', { name: '系统' })).not.toBeInTheDocument()
    expect(screen.getByText('系统').nextElementSibling).toBe(dependenciesItem)
    fireEvent.click(dependenciesItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/dependencies' })
  })

  it('places Skills below MCP and prompt management directly below Skills', () => {
    render(<SettingsPage />)

    const mcpItem = screen.getByText('MCP').closest('button')
    const skillsItem = screen.getByRole('button', { name: '技能' })

    expect(mcpItem).not.toBeNull()
    expect(mcpItem?.nextElementSibling).toBe(skillsItem)
    fireEvent.click(skillsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/skills' })

    const promptsItem = screen.getByRole('button', { name: '提示词' })
    expect(skillsItem.nextElementSibling).toBe(promptsItem)
    fireEvent.click(promptsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/prompts' })
  })

  it('opens the Hooks overview from the tools menu', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: zhCN['settings.hooks.title'] }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/hooks' })
  })

  it('merges quick access into efficiency and places both assistants last', () => {
    render(<SettingsPage />)

    expect(screen.getByText('效率')).toBeInTheDocument()
    expect(screen.queryByText('快捷入口')).not.toBeInTheDocument()

    const efficiencyItems = ['频道', '定时任务', '快捷键', '快捷助手', '划词助手', '截图'].map((name) =>
      screen.getByRole('button', { name })
    )
    const menuItems = screen.getAllByTestId('menu-item')
    const efficiencyStart = menuItems.indexOf(efficiencyItems[0])

    expect(menuItems.slice(efficiencyStart, efficiencyStart + efficiencyItems.length)).toEqual(efficiencyItems)
    expect(efficiencyItems.at(-1)?.nextElementSibling).toHaveAttribute('data-testid', 'menu-divider')
  })
})

describe('Hooks settings overview', () => {
  const agents: AgentEntity[] = (['pi', 'claude-code', 'dsh'] as const).map((type, index) => ({
    id: 'hooks-agent-' + type,
    name: type + ' agent',
    type,
    model: null,
    modelName: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    orderKey: 'a' + index,
    configuration: {
      hooks: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Hook ' + type,
          event: 'preToolUse',
          command: 'echo ' + type,
          enabled: type !== 'dsh',
          timeoutMs: 1000
        }
      ]
    }
  }))

  beforeEach(() => {
    MockUseDataApiUtils.mockPaginatedData('/agents', agents)
  })

  it('shows configured Hooks under their agents, including disabled Hooks, and refreshes changed data', () => {
    const { rerender } = render(<HooksSettings />)
    for (const agent of agents) {
      const group = within(screen.getByRole('region', { name: agent.name }))
      expect(group.getByText('echo ' + agent.type)).toBeInTheDocument()
      expect(
        group.getByText(agent.type === 'dsh' ? zhCN['common.disabled'] : zhCN['common.enabled'])
      ).toBeInTheDocument()
    }
    MockUseDataApiUtils.mockPaginatedData('/agents', [{ ...agents[0], configuration: { hooks: [] } }, agents[1]])
    rerender(<HooksSettings />)
    expect(screen.queryByRole('region', { name: agents[0].name })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: agents[2].name })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: agents[1].name })).toBeInTheDocument()
  })

  it('opens the selected agent on its Hooks tab', async () => {
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: agents[0] })
    const agentQuery = mockUseQuery.getMockImplementation()!
    const queries = new Map([['/agents/:agentId', agentQuery]])
    for (const path of [
      '/skills',
      '/providers',
      '/models',
      '/pins',
      '/prompts',
      '/prompt-bindings/:targetType/:targetId',
      '/mcp-servers'
    ] as const) {
      MockUseDataApiUtils.mockQueryData(path, [])
      queries.set(path, mockUseQuery.getMockImplementation()!)
    }
    mockUseQuery.mockImplementation((path, options) => (queries.get(path) ?? agentQuery)(path, options))
    const user = userEvent.setup()
    render(<HooksSettings />)
    await user.click(
      within(screen.getByRole('region', { name: agents[0].name })).getByRole('button', { name: zhCN['common.edit'] })
    )
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('tab', { name: zhCN['agent_hooks.title'] })).toHaveAttribute('aria-selected', 'true')
    expect(dialog.getByLabelText(zhCN['agent_hooks.command'])).toHaveValue('echo pi')
  })

  it('distinguishes an empty page from a load failure and allows retry', async () => {
    MockUseDataApiUtils.mockPaginatedData('/agents', [], { total: 501, hasNext: true })
    const { rerender } = render(<HooksSettings />)
    expect(screen.getByText(zhCN['settings.hooks.empty'])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: zhCN['common.next'] })).toBeEnabled()
    const refresh = vi.fn()
    const emptyPage = mockUsePaginatedQuery('/agents')
    mockUsePaginatedQuery.mockReturnValue({ ...emptyPage, error: new Error('Unavailable'), refresh })
    rerender(<HooksSettings />)
    expect(screen.queryByText(zhCN['settings.hooks.empty'])).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: zhCN['common.retry'] }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})
