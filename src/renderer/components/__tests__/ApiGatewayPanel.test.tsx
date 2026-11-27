import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'

import ApiGatewayPanel from '../ApiGatewayPanel'

const useApiGatewayMock = vi.fn()

vi.mock(import('@cherrystudio/ui'), async (importOriginal) => ({
  ...(await importOriginal()),
  ...(await import('@cherrystudio/ui/components/primitives/popover'))
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => useApiGatewayMock()
}))

vi.mock('react-i18next', async () => {
  const { default: locale } = await import('@renderer/i18n/locales/en-us.json')
  return {
    useTranslation: () => ({
      t: (key: string, options?: { name?: string }) =>
        ((locale as Record<string, string>)[key] ?? key).replace('{{name}}', options?.name ?? '')
    })
  }
})

const gatewayState = () => ({
  apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-test-key', enabled: false },
  apiGatewayRunning: false,
  apiGatewayLoading: false,
  startApiGateway: vi.fn(),
  stopApiGateway: vi.fn(),
  restartApiGateway: vi.fn(),
  setApiGatewayConfig: vi.fn()
})

describe('ApiGatewayPanel', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    useApiGatewayMock.mockReturnValue(gatewayState())
  })

  it('copies all four client URLs using the bound port', async () => {
    const user = userEvent.setup()
    const config = gatewayState()
    const { rerender } = render(<ApiGatewayPanel />)
    const copyBaseUrl = screen.getByRole('button', { name: 'Copy · Base URL' })
    await user.click(copyBaseUrl)
    expect(await navigator.clipboard.readText()).toBe('http://127.0.0.1:23333/v1')

    useApiGatewayMock.mockReturnValue({
      ...config,
      apiGatewayRunning: true,
      apiGatewayEndpoint: { host: '0.0.0.0', port: 24444 }
    })
    rerender(<ApiGatewayPanel />)
    for (const [label, path] of [
      ['Base URL', '/v1'],
      ['OpenAI', '/v1/chat/completions'],
      ['OpenAI Responses', '/v1/responses'],
      ['Anthropic', '/v1/messages']
    ]) {
      await user.click(screen.getByRole('button', { name: `Copy · ${label}` }))
      expect(await navigator.clipboard.readText()).toBe(`http://127.0.0.1:24444${path}`)
    }
  })

  it('finds models by name and copies the exact provider-qualified ID', async () => {
    const id = '12345678-df3f-484c-8ecf-6a65b31900a4:claude-sonnet'
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
      ok: true,
      data: [
        { id, owned_by: 'Work provider' },
        { id: 'openai:gpt-5', owned_by: 'OpenAI' }
      ]
    })
    const user = userEvent.setup()
    render(<ApiGatewayPanel />)
    await user.click(screen.getByRole('button', { name: 'Models' }))
    const models = within(await screen.findByRole('dialog', { name: 'Models' }))
    await user.type(await models.findByRole('searchbox'), 'sonnet')
    expect(models.queryByText('gpt-5')).not.toBeInTheDocument()
    await user.click(models.getByRole('button', { name: `Copy · ${id}` }))
    expect(await navigator.clipboard.readText()).toBe(id)
  })

  it('keeps the LAN key out of local setup and remasks it after rotation', async () => {
    const user = userEvent.setup()
    const state = gatewayState()
    const { rerender } = render(<ApiGatewayPanel />)
    expect(screen.queryByLabelText(en['apiGateway.fields.apiKey.label'])).not.toBeInTheDocument()
    MockUsePreferenceUtils.setPreferenceValue('feature.api_gateway.lan_http_enabled', true)
    rerender(<ApiGatewayPanel />)

    const keyField = () => screen.getByLabelText(en['apiGateway.fields.apiKey.label'])
    expect(keyField()).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: en['settings.provider.api_key.show_key'] }))
    expect(keyField()).toHaveAttribute('type', 'text')
    useApiGatewayMock.mockReturnValue({
      ...state,
      apiGatewayConfig: { ...state.apiGatewayConfig, apiKey: 'cs-sk-new-key' }
    })
    rerender(<ApiGatewayPanel />)
    expect(keyField()).toHaveAttribute('type', 'password')
  })
})
