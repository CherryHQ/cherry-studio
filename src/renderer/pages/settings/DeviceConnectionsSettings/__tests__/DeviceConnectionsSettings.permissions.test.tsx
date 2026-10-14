import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: { enabled: true, host: '0.0.0.0', port: 23333 },
    apiGatewayRunning: true,
    apiGatewayLoading: false
  })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request }, useIpcOn: () => {} }))
vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsContentColumn: ({ children }: PropsWithChildren) => <div>{children}</div>
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: keyof typeof enUS, options?: { capability?: string }) =>
      enUS[key].replace('{{capability}}', options?.capability ?? '')
  })
}))

import DeviceConnectionsSettings from '../DeviceConnectionsSettings'

describe('Device connection capability revocation', () => {
  beforeEach(() => {
    request.mockReset().mockResolvedValue([])
    MockUseCacheUtils.resetMocks()
    MockUseCacheUtils.setPersistCacheValue('settings.device_connections.step', 'complete')
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
    MockUseDataApiUtils.resetMocks()
  })

  it('revokes only Assistant access while keeping the device and its Agent grant', async () => {
    const device = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'My phone',
      platform: 'ios',
      createdAt: '2026-10-14T00:00:00Z',
      updatedAt: '2026-10-14T00:00:00Z',
      remoteAccess: { capabilities: ['agent', 'assistant'] }
    }
    const unpair = vi.fn()
    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [device])
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/api-gateway/paired-devices/:id', unpair)
    MockUseDataApiUtils.mockMutationWithTrigger(
      'DELETE',
      '/api-gateway/paired-devices/:id/capabilities/:capability',
      async ({ params }: { params: { id: string; capability: string } }) => {
        if (params.id === device.id)
          MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [
            {
              ...device,
              remoteAccess: {
                capabilities: device.remoteAccess.capabilities.filter((capability) => capability !== params.capability)
              }
            }
          ])
      }
    )
    render(<DeviceConnectionsSettings />)
    const label = enUS['deviceConnections.devices.revokeCapability'].replace(
      '{{capability}}',
      enUS['deviceConnections.capabilities.assistant']
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: label }))
    expect(unpair).not.toHaveBeenCalled()
    expect(screen.getByText('My phone')).toBeVisible()
    expect(screen.getByText(enUS['deviceConnections.capabilities.agent'])).toBeVisible()
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
  })
})
