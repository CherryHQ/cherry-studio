import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import type * as PreferenceModule from '@data/PreferenceService'
import { preferenceService } from '@data/PreferenceService'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import type { AgentHook } from '@shared/ai/agentHook'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'

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
        'deviceConnections.title': '设备互联',
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

const preferenceBridge = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  subscribe: vi.fn().mockResolvedValue(undefined),
  listeners: new Set<Parameters<typeof window.api.preference.onChanged>[0]>()
}))

vi.unmock('@data/hooks/usePreference')
vi.mock('@data/PreferenceService', async (importOriginal) => {
  const actual = await importOriginal<typeof PreferenceModule>()
  const { EventEmitter } = await import('node:events')
  // The renderer setup has no preference bridge to reuse for the IPC cleanup return value.
  const ipcRenderer = Object.assign(new EventEmitter(), {
    invoke: vi.fn<Electron.IpcRenderer['invoke']>().mockResolvedValue(undefined),
    postMessage: vi.fn<Electron.IpcRenderer['postMessage']>(),
    send: vi.fn<Electron.IpcRenderer['send']>(),
    sendSync: vi.fn<Electron.IpcRenderer['sendSync']>(),
    sendToHost: vi.fn<Electron.IpcRenderer['sendToHost']>()
  }) satisfies Electron.IpcRenderer
  window.api.preference = {
    ...window.api.preference,
    get: preferenceBridge.get,
    set: preferenceBridge.set,
    subscribe: preferenceBridge.subscribe,
    onChanged: (listener) => {
      preferenceBridge.listeners.add(listener)
      return () => {
        preferenceBridge.listeners.delete(listener)
        return ipcRenderer
      }
    }
  }
  return { ...actual, preferenceService: new actual.PreferenceService() }
})

describe('SettingsPage', () => {
  beforeEach(() => {
    preferenceService.clearCache()
    preferenceBridge.get.mockReset().mockImplementation(async (key) => getDefaultValue(key))
    isMacTransparentWindowMock.mockReturnValue(false)
    navigateMock.mockReset()
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

  it('exposes device connections as its own settings destination without developer mode', async () => {
    preferenceBridge.get.mockImplementation(async (key) =>
      key === 'app.developer_mode.enabled' ? false : getDefaultValue(key)
    )
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: '设备互联' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/device-connections' })
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

  it('opens global Hooks settings from the tools menu', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: zhCN['settings.hooks.title'] }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/hooks' })
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

describe('Global Hooks settings', () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture ??= () => false
    HTMLElement.prototype.setPointerCapture ??= () => {}
    HTMLElement.prototype.releasePointerCapture ??= () => {}
    HTMLElement.prototype.scrollIntoView ??= () => {}
  })
  const rule: AgentHook = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'saved hook',
    event: 'preToolUse',
    command: 'exit 0',
    enabled: true,
    timeoutMs: 10_000
  }
  let persisted: AgentHook[]
  beforeEach(() => {
    preferenceService.clearCache()
    persisted = []
    preferenceBridge.get
      .mockReset()
      .mockImplementation(async (key) => (key === 'agent.hooks' ? structuredClone(persisted) : getDefaultValue(key)))
    preferenceBridge.set.mockReset().mockImplementation(async (_key, value) => {
      persisted = structuredClone(value)
    })
  })

  it('does not enable editing on an unresolved or failed load and can retry', async () => {
    const load = Promise.withResolvers<AgentHook[]>()
    preferenceBridge.get.mockReturnValueOnce(load.promise)
    const user = userEvent.setup()
    render(<HooksSettings />)
    expect(screen.getByRole('status')).toHaveTextContent(zhCN['common.loading'])
    expect(screen.queryByRole('button', { name: zhCN['agent_hooks.add'] })).not.toBeInTheDocument()
    await act(async () => load.reject(new Error('IPC unavailable')))
    expect(await screen.findByRole('button', { name: zhCN['common.retry'] })).toBeEnabled()
    expect(preferenceBridge.set).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: zhCN['common.retry'] }))
    expect(await screen.findByRole('button', { name: zhCN['agent_hooks.add'] })).toBeEnabled()
  })

  it('auto-saves global rules, applies the enable switch directly, and confirms deletion', async () => {
    const user = userEvent.setup()
    render(<HooksSettings />)
    await user.click(await screen.findByRole('button', { name: zhCN['agent_hooks.add'] }))
    await waitFor(() => expect(persisted).toHaveLength(1))
    expect(screen.queryByRole('button', { name: zhCN['common.save'] })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: zhCN['common.cancel'] })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: zhCN['agent_hooks.enabled'] })).toBeDisabled()
    await user.click(screen.getByLabelText(zhCN['agent_hooks.command']))
    await user.paste('exit 0')
    await user.click(screen.getByRole('combobox', { name: zhCN['agent_hooks.event'] }))
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('option', { name: zhCN['agent_hooks.events.approval_requested'] }))
    await user.click(screen.getByLabelText(zhCN['agent_hooks.matcher.tool_name']))
    await user.paste('write')
    await user.click(screen.getByLabelText(zhCN['agent_hooks.matcher.input']))
    await user.paste('test.txt')
    await user.click(screen.getByRole('switch', { name: zhCN['agent_hooks.enabled'] }))
    await waitFor(() =>
      expect(persisted).toEqual([
        expect.objectContaining({
          event: 'approvalRequested',
          command: 'exit 0',
          enabled: true,
          matcher: { toolNameContains: 'write', inputContains: 'test.txt' }
        })
      ])
    )
    await user.type(screen.getByLabelText(zhCN['agent_hooks.command']), '; exit 2')
    expect(screen.getByRole('switch', { name: zhCN['agent_hooks.enabled'] })).not.toBeChecked()
    await waitFor(() => expect(persisted[0]).toMatchObject({ command: 'exit 0; exit 2', enabled: false }))

    await user.click(screen.getByRole('button', { name: zhCN['agent_hooks.remove'] }))
    let dialog = await screen.findByRole('dialog', { name: zhCN['agent_hooks.remove'] })
    expect(persisted).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: zhCN['common.cancel'] }))
    expect(screen.queryByRole('dialog', { name: zhCN['agent_hooks.remove'] })).not.toBeInTheDocument()
    expect(persisted).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: zhCN['agent_hooks.remove'] }))
    dialog = await screen.findByRole('dialog', { name: zhCN['agent_hooks.remove'] })
    await user.click(within(dialog).getByRole('button', { name: zhCN['common.delete'] }))
    await waitFor(() => expect(persisted).toEqual([]))
  })

  it('starts saved Hook entries collapsed and keeps their summary controls available', async () => {
    persisted = [rule]
    const user = userEvent.setup()
    render(<HooksSettings />)

    const collapse = await screen.findByRole('button', { name: /saved hook/ })
    expect(collapse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: zhCN['agent_hooks.command'] })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: zhCN['agent_hooks.enabled'] })).toBeVisible()
    expect(screen.getByRole('button', { name: zhCN['agent_hooks.remove'] })).toBeVisible()

    await user.click(screen.getByRole('button', { name: zhCN['agent_hooks.add'] }))
    await waitFor(() => expect(persisted).toHaveLength(2))
    expect(collapse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: new RegExp(`^${zhCN['agent_hooks.title']}`) })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it.each(['mounted', 'unmounted', 'remounted'])('recovers a failed auto-save while %s', async (phase) => {
    persisted = [rule]
    const save = Promise.withResolvers<void>()
    preferenceBridge.set.mockReturnValueOnce(save.promise)
    const user = userEvent.setup()
    const view = render(<HooksSettings />)
    await user.click(await screen.findByRole('button', { name: /saved hook/ }))
    await user.type(screen.getByLabelText(zhCN['agent_hooks.command']), '; exit 2')
    if (phase !== 'mounted') view.unmount()
    if (phase === 'remounted') render(<HooksSettings />)
    await waitFor(() => expect(preferenceBridge.set).toHaveBeenCalledTimes(1))
    await act(async () => save.reject(new Error('Disk full')))
    if (phase === 'unmounted') render(<HooksSettings />)

    expect(await screen.findByText(zhCN['settings.hooks.save_failed'])).toBeInTheDocument()
    if (phase !== 'mounted') await user.click(screen.getByRole('button', { name: /saved hook/ }))
    expect(screen.getByLabelText(zhCN['agent_hooks.command'])).toHaveValue('exit 0; exit 2')
    expect(persisted[0].command).toBe('exit 0')
    await user.click(screen.getByRole('button', { name: zhCN['common.retry'] }))
    await waitFor(() => expect(persisted[0]).toMatchObject({ command: 'exit 0; exit 2', enabled: false }))
    expect(screen.queryByText(zhCN['settings.hooks.save_failed'])).not.toBeInTheDocument()
  })

  it('serializes saves across remounts without losing newer edits', async () => {
    persisted = [rule]
    const saves = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    for (const save of saves) {
      preferenceBridge.set.mockImplementationOnce(async (_key, value) => {
        await save.promise
        persisted = structuredClone(value)
      })
    }
    const user = userEvent.setup()
    const firstView = render(<HooksSettings />)

    try {
      await user.click(await screen.findByRole('switch', { name: zhCN['agent_hooks.enabled'] }))
      await waitFor(() => expect(preferenceBridge.set).toHaveBeenCalledTimes(1))
      await user.click(screen.getByRole('button', { name: /saved hook/ }))
      await user.type(screen.getByLabelText(zhCN['agent_hooks.name']), ' updated')
      firstView.unmount()
      await act(async () => {
        render(<HooksSettings />)
      })

      expect(preferenceBridge.set).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('switch', { name: zhCN['agent_hooks.enabled'] })).not.toBeInTheDocument()
      await act(async () => saves[0].resolve())
      expect(preferenceBridge.set).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('status')).toHaveTextContent(zhCN['common.loading'])
      await act(async () => saves[1].resolve())

      await user.click(await screen.findByRole('button', { name: /saved hook updated/ }))
      await user.type(screen.getByLabelText(zhCN['agent_hooks.name']), ' again')
      await waitFor(() => expect(persisted).toEqual([{ ...rule, enabled: false, name: 'saved hook updated again' }]))
    } finally {
      await act(async () => saves.forEach((save) => save.resolve()))
    }
  })

  it('does not silently replace damaged global settings with an empty list', async () => {
    preferenceBridge.get.mockResolvedValueOnce('damaged')
    render(<HooksSettings />)
    expect(await screen.findByText(zhCN['settings.hooks.invalid'])).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: zhCN['agent_hooks.add'] })).not.toBeInTheDocument()
    expect(preferenceBridge.set).not.toHaveBeenCalled()
  })
})
