import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUiModule from '@cherrystudio/ui'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { ipcApi } from '@renderer/ipc'

import SettingsPage from '../SettingsPage'

const { isMacTransparentWindowMock, navigateMock, locationMock } = vi.hoisted(() => ({
  isMacTransparentWindowMock: vi.fn(),
  navigateMock: vi.fn(),
  locationMock: { pathname: '/settings/provider' }
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryUiModule>()),
  MenuDivider: () => <hr data-testid="menu-divider" />,
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
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => isMacTransparentWindowMock()
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => (
    <>
      <a href="https://open.cherryin.ai" target="_blank" rel="noreferrer">
        <span>Provider website</span>
      </a>
      <a href="#provider">Internal settings</a>
    </>
  ),
  useLocation: () => locationMock,
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
        'deviceConnections.title': '设备互联',
        'selection.name': '划词助手',
        'settings.appearance.title': '外观',
        'settings.voice.title': '语音',
        'settings.channels.title': '频道',
        'settings.dependencies.title': '环境依赖',
        'settings.dependencies.localModels.title': '本地模型',
        'settings.general.common.title': zhCN['settings.general.common.title'],
        'settings.menuGroups.automation': '效率',
        'settings.menuGroups.builtinTools': '内置工具',
        'settings.menuGroups.capabilities': '工具',
        'settings.menuGroups.personal': '偏好',
        'settings.menuGroups.quickAccess': '快捷入口',
        'settings.menuGroups.system': '系统',
        'settings.model': '默认模型',
        'settings.computerUse.title': '电脑操作',
        'settings.browser.title': '浏览器',
        'settings.tool.websearch.title': '网络搜索',
        'settings.prompts.title': '提示词',
        'settings.quickAssistant.title': '快捷助手',
        'settings.reasoning_effort_mappings.title': zhCN['settings.reasoning_effort_mappings.title'],
        'settings.scheduledTasks.title': '定时任务',
        'settings.screenshot.title': '截图',
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
    MockUsePreferenceUtils.resetMocks()
    isMacTransparentWindowMock.mockReturnValue(false)
    navigateMock.mockReset()
    locationMock.pathname = '/settings/provider'
    vi.mocked(ipcApi.request).mockClear()
  })

  it.each(['click', 'auxclick'])(
    'opens settings websites externally on %s even when internal browsing is enabled',
    (type) => {
      MockUsePreferenceUtils.setPreferenceValue('app.browser.open_links_in_browser', true)
      render(<SettingsPage />)
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'auxclick' ? 1 : 0 })
      fireEvent(screen.getByText('Provider website'), event)
      expect(event.defaultPrevented).toBe(true)
      expect(ipcApi.request).toHaveBeenCalledWith('system.shell.open_external_website', 'https://open.cherryin.ai/')
    }
  )

  it('leaves internal settings navigation and right-click menus alone', () => {
    render(<SettingsPage />)
    const internalClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByText('Internal settings'), internalClick)
    const rightClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 })
    fireEvent(screen.getByText('Provider website'), rightClick)
    expect(internalClick.defaultPrevented).toBe(false)
    expect(rightClick.defaultPrevented).toBe(false)
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('mounts the full-width search field from the header icon only on demand', () => {
    // Off the search page: no field in the DOM, just the quiet header icon
    render(<SettingsPage />)
    expect(screen.queryByTestId('settings-search-input')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.search.placeholder' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.search.placeholder' }))
    expect(screen.getByTestId('settings-search-input')).toBeInTheDocument()

    // Empty-field Escape reports collapse; the page unmounts the field again
    fireEvent.keyDown(screen.getByTestId('settings-search-input'), { key: 'Escape' })
    expect(screen.queryByTestId('settings-search-input')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.search.placeholder' })).toBeInTheDocument()
  })

  it('opens General and local model settings', () => {
    render(<SettingsPage />)

    const generalItem = screen.getByRole('button', { name: '通用' })
    const defaultModelItem = screen.getByRole('button', { name: '默认模型' })
    const reasoningEffortItem = screen.getByRole('button', { name: '思考强度映射' })
    const localModelsItem = screen.getByRole('button', { name: '本地模型' })

    expect(defaultModelItem.nextElementSibling).toBe(reasoningEffortItem)
    expect(reasoningEffortItem.nextElementSibling).toBe(localModelsItem)
    fireEvent.click(generalItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/general' })
    fireEvent.click(localModelsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/local-models' })
  })

  it('exposes device connections as its own settings destination without developer mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    render(<SettingsPage />)

    const deviceConnectionsItem = screen.getByRole('button', { name: '设备互联' })
    fireEvent.click(deviceConnectionsItem)

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/device-connections' })
  })

  it('exposes Voice as a searchable personal settings destination', () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '语音' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/voice' })
  })

  it('opens dependency settings', () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '环境依赖' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/dependencies' })
  })

  it('opens skills and built-in prompt management', () => {
    render(<SettingsPage />)

    const skillsItem = screen.getByRole('button', { name: '技能' })

    fireEvent.click(skillsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/skills' })

    const builtinToolsItem = screen.getByRole('button', { name: '内置工具' })
    fireEvent.click(builtinToolsItem)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/prompts' })
  })

  it('shows the six built-in settings destinations in a secondary menu and preserves their routes', () => {
    locationMock.pathname = '/settings/browser'
    render(<SettingsPage />)
    const menu = within(screen.getByRole('navigation', { name: '内置工具' }))
    const destinations = [
      ['提示词', '/settings/prompts'],
      ['电脑操作', '/settings/computer-use'],
      ['浏览器', '/settings/browser'],
      ['网络搜索', '/settings/websearch'],
      ['文档处理', '/settings/file-processing'],
      ['OCR', '/settings/ocr']
    ]
    expect(menu.getAllByRole('button').map((button) => button.textContent)).toEqual(
      destinations.map(([label]) => label)
    )
    for (const [label, route] of destinations) {
      fireEvent.click(menu.getByRole('button', { name: label }))
      expect(navigateMock).toHaveBeenLastCalledWith({ to: route })
    }
    expect(menu.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(menu.queryByRole('button', { name: '技能' })).not.toBeInTheDocument()
  })

  it('updates the secondary selection on direct navigation and removes it on other settings pages', () => {
    locationMock.pathname = '/settings/browser'
    const { rerender } = render(<SettingsPage />)
    const selectedItem = () => within(screen.getByRole('navigation', { name: '内置工具' }))
    expect(selectedItem().getByRole('button', { name: '浏览器' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: '内置工具' })).toHaveAttribute('data-active', 'true')

    locationMock.pathname = '/settings/ocr'
    rerender(<SettingsPage />)
    expect(selectedItem().getByRole('button', { name: '浏览器' })).not.toHaveAttribute('data-active')
    expect(selectedItem().getByRole('button', { name: 'OCR' })).toHaveAttribute('data-active', 'true')

    locationMock.pathname = '/settings/data'
    rerender(<SettingsPage />)
    expect(screen.queryByRole('navigation', { name: '内置工具' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '内置工具' })).not.toHaveAttribute('data-active')
  })
})
