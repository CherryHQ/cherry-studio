import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUiModule from '@cherrystudio/ui'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'

import SettingsPage from '../SettingsPage'
import { UserMemorySettings } from '../UserMemorySettings'

vi.mock('@renderer/components/markdown', () => ({
  StaticMarkdown: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

const { isMacTransparentWindowMock, navigateMock } = vi.hoisted(() => ({
  isMacTransparentWindowMock: vi.fn(),
  navigateMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryUiModule>()),
  MenuDivider: () => <hr data-testid="menu-divider" />,
  MenuItem: ({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick?: () => void }) => (
    <button type="button" data-testid="menu-item" onClick={onClick}>
      {icon}
      {label}
    </button>
  ),
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
        'deviceConnections.title': '设备互联',
        'selection.name': '划词助手',
        'settings.appearance.title': '外观',
        'settings.voice.title': '语音',
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
      })[key] ?? key
  })
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    isMacTransparentWindowMock.mockReturnValue(false)
    navigateMock.mockReset()
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

  it('merges quick access into efficiency and places both assistants last', () => {
    render(<SettingsPage />)

    expect(screen.getByText('效率')).toBeInTheDocument()
    expect(screen.queryByText('快捷入口')).not.toBeInTheDocument()

    const efficiencyItems = ['频道', '设备互联', '定时任务', '快捷键', '快捷助手', '划词助手', '截图'].map((name) =>
      screen.getByRole('button', { name })
    )
    const menuItems = screen.getAllByTestId('menu-item')
    const efficiencyStart = menuItems.indexOf(efficiencyItems[0])

    expect(menuItems.slice(efficiencyStart, efficiencyStart + efficiencyItems.length)).toEqual(efficiencyItems)
    expect(efficiencyItems.at(-1)?.nextElementSibling).toHaveAttribute('data-testid', 'menu-divider')
  })
})

describe('User memory settings', () => {
  let stored: { content: string; revision: string }
  let rejectStale: boolean
  let writes: Array<{ content: string; expectedRevision: string }>

  beforeEach(() => {
    stored = { content: 'Prefer pnpm', revision: 'v1' }
    rejectStale = false
    writes = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      if (route === 'memory.user.facts.read') return { ...stored } as never
      if (route === 'memory.user.journal.search') {
        return [{ ts: '2026-10-20T00:00:00.000Z', tags: [], text: 'Historical event' }] as never
      }
      if (route === 'memory.user.facts.update') {
        const input = args[0] as { content: string; expectedRevision: string }
        writes.push(input)
        if (rejectStale) {
          rejectStale = false
          stored = { content: 'Prefer pnpm\nUse TypeScript', revision: 'v2' }
        }
        if (input.expectedRevision !== stored.revision) throw new IpcError('MEMORY_CONFLICT')
        stored = { content: input.content, revision: 'saved' }
        return { ...stored } as never
      }
      return undefined as never
    })
  })

  function openMemory() {
    render(
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>
        <UserMemorySettings />
      </SWRConfig>
    )
    fireEvent.click(screen.getByRole('button', { name: 'settings.user_memory.load' }))
    return screen.findByDisplayValue('Prefer pnpm')
  }

  it('does not read or reveal memory until the user loads it, including cached content', async () => {
    const cache = new Map()
    const view = () => (
      <SWRConfig value={{ provider: () => cache }}>
        <UserMemorySettings />
      </SWRConfig>
    )
    const first = render(view())
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.user_memory.load' }))
    await screen.findByDisplayValue('Prefer pnpm')
    await screen.findByText('Historical event')
    first.unmount()
    vi.mocked(ipcApi.request).mockClear()
    render(view())
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Historical event')).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('saves edited facts with the revision read by the editor', async () => {
    const editor = await openMemory()
    fireEvent.change(editor, { target: { value: 'Prefer npm' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(stored.content).toBe('Prefer npm'))
    expect(writes).toEqual([{ content: 'Prefer npm', expectedRevision: 'v1' }])
  })

  it('preserves a conflicting draft and saves only the explicitly merged version', async () => {
    const editor = await openMemory()
    fireEvent.change(editor, { target: { value: 'Prefer yarn' } })
    rejectStale = true
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await screen.findByText('settings.user_memory.conflict')
    await screen.findByText('Prefer pnpm Use TypeScript')
    expect(editor).toHaveValue('Prefer yarn')
    expect(stored.content).toBe('Prefer pnpm\nUse TypeScript')
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()
    fireEvent.change(editor, { target: { value: 'Prefer yarn\nUse TypeScript' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.user_memory.merge' }))
    await waitFor(() => expect(stored.content).toBe('Prefer yarn\nUse TypeScript'))
    expect(writes.at(-1)).toEqual({ content: 'Prefer yarn\nUse TypeScript', expectedRevision: 'v2' })
  })

  it('requires confirmation to clear facts and retains the historical journal', async () => {
    await openMemory()
    fireEvent.click(screen.getByRole('button', { name: 'settings.user_memory.clear' }))
    expect(stored.content).toBe('Prefer pnpm')
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(stored.content).toBe(''))
    expect(screen.getByLabelText('settings.user_memory.title')).toHaveValue('')
    expect(screen.getByText('Historical event')).toBeInTheDocument()
  })
})
