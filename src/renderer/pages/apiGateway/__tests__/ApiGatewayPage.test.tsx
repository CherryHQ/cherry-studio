import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'

import ApiGatewayPage from '../ApiGatewayPage'

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: '' },
    apiGatewayRunning: false,
    apiGatewayLoading: false,
    startApiGateway: vi.fn(),
    stopApiGateway: vi.fn(),
    restartApiGateway: vi.fn(),
    setApiGatewayConfig: vi.fn()
  })
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('react-i18next', async () => {
  const { default: locale } = await import('@renderer/i18n/locales/en-us.json')
  return { useTranslation: () => ({ t: (key: string) => (locale as Record<string, string>)[key] ?? key }) }
})

describe('ApiGatewayPage', () => {
  it('shows the real stopped panel with a start action', () => {
    const { container } = render(
      <main>
        <ApiGatewayPage />
      </main>
    )
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(container.querySelector('[data-ui~="api-gateway.view"]')).toBeInTheDocument()
    expect(container.querySelector('[data-ui~="api-gateway.panel"]')).toBeInTheDocument()
    expect(screen.getByText(en['code.api_gateway.title'])).toBeInTheDocument()
    expect(screen.getByText(en['apiGateway.status.stopped'])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en['apiGateway.actions.start'] })).toBeInTheDocument()
  })
})
