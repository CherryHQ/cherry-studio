import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zh from '@renderer/i18n/locales/zh-cn.json'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

import { LocalAgentConfigControl } from '../LocalAgentConfigControl'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.unmock('react-i18next')
const i18n = createInstance()
const renderControl = (props: Parameters<typeof LocalAgentConfigControl>[0]) => {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LocalAgentConfigControl {...props} />
    </I18nextProvider>
  )
  const trigger = screen.queryByRole('button', { name: i18n.t('local_agents.configuration') })
  if (trigger) fireEvent.keyDown(trigger, { key: 'Enter' })
  return view
}

const mode = {
  id: 'native-mode',
  currentValue: 'ask',
  options: [
    { value: 'ask', name: 'Ask' },
    { value: 'plan', name: 'Plan' }
  ]
}

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en }, zh: { translation: zh } },
    keySeparator: false
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => vi.clearAllMocks())

describe('native session modes', () => {
  it('sends native mode IDs and keeps the confirmed selection when rejected', async () => {
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('Cannot switch now'))
    renderControl({ sessionId: 'session', mode, disabled: false })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Plan' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: Cannot switch now'))
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
      sessionId: 'session',
      configId: 'native-mode',
      value: 'plan'
    })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Ask' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('translates known labels and descriptions while retaining native IDs and custom semantics', async () => {
    await i18n.changeLanguage('zh')
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    renderControl({
      sessionId: 'session',
      disabled: false,
      mode: {
        ...mode,
        options: [
          {
            value: 'native-code-id',
            name: 'code',
            description: 'The default agent. Executes tools based on configured permissions.'
          },
          { value: 'ask', name: 'ask', description: 'Custom approval policy' },
          { value: 'custom', name: 'My custom mode', description: 'Project-specific behavior' }
        ]
      }
    })
    expect(screen.getByRole('menuitemradio', { name: /问答/ })).toHaveAttribute('aria-checked', 'true')
    const code = await screen.findByRole('menuitemradio', { name: /编程/ })
    expect(code).toHaveTextContent('根据配置的权限执行工具。')
    expect(screen.getByText('Custom approval policy')).toBeInTheDocument()
    expect(screen.getByText('My custom mode')).toBeInTheDocument()
    fireEvent.click(code)
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
        sessionId: 'session',
        configId: 'native-mode',
        value: 'native-code-id'
      })
    )
  })

  it('localizes CodeBuddy permissions without changing their native values', async () => {
    await i18n.changeLanguage('zh')
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    renderControl({
      sessionId: 'session',
      disabled: false,
      mode: {
        id: 'mode',
        currentValue: 'default',
        options: [
          { value: 'default', name: 'Always Ask', description: 'Prompts for permission on first use of each tool' },
          { value: 'delegate', name: 'Delegate', description: 'Permissions managed by parent session' }
        ]
      }
    })
    expect(screen.getByRole('menuitemradio', { name: /始终询问/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('首次使用每个工具时请求授权')).toBeVisible()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '委派 权限由父会话管理' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
        sessionId: 'session',
        configId: 'mode',
        value: 'delegate'
      })
    )
  })

  it('opens a lone reasoning selector directly and submits its native value', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    renderControl({
      sessionId: 'session',
      disabled: false,
      thoughtLevel: {
        id: 'thought_level',
        currentValue: 'low',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' }
        ]
      }
    })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_thought_level', {
        sessionId: 'session',
        configId: 'thought_level',
        value: 'high'
      })
    )
  })

  it('does not expose a single fixed mode as a configurable control', () => {
    renderControl({ sessionId: 'session', mode: { ...mode, options: mode.options.slice(0, 1) }, disabled: false })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })
})
