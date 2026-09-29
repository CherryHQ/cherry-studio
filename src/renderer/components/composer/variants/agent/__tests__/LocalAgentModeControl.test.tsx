import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zh from '@renderer/i18n/locales/zh-cn.json'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

import { LocalAgentModeControl } from '../LocalAgentModeControl'

vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/select'))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.unmock('react-i18next')
const i18n = createInstance()
const renderControl = (props: Parameters<typeof LocalAgentModeControl>[0]) =>
  render(
    <I18nextProvider i18n={i18n}>
      <LocalAgentModeControl {...props} />
    </I18nextProvider>
  )

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
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Plan' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: Cannot switch now'))
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
      sessionId: 'session',
      configId: 'native-mode',
      value: 'plan'
    })
    expect(screen.getByRole('combobox')).not.toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveTextContent('Ask')
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
    expect(screen.getByRole('combobox')).toHaveTextContent('问答')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    const code = await screen.findByRole('option', { name: /编程/ })
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

  it('does not expose a single fixed mode as a configurable control', () => {
    renderControl({ sessionId: 'session', mode: { ...mode, options: mode.options.slice(0, 1) }, disabled: false })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
