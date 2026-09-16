import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'

const { requestMock, navigateMock, useApiGatewayMock, useIpcOnMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  navigateMock: vi.fn(),
  useApiGatewayMock: vi.fn(),
  useIpcOnMock: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingGroup: ({ children }: PropsWithChildren) => <section>{children}</section>,
  SettingRowTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsContentColumn: ({ children }: PropsWithChildren) => <main>{children}</main>,
  SettingTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => useApiGatewayMock()
}))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock }, useIpcOn: useIpcOnMock }))
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ title, value }: { title: string; value: string }) => (
    <output role="img" aria-label={title} data-value={value} />
  )
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: keyof typeof enUS) => enUS[key] }) }))

import DeviceConnectionsSettings from '../DeviceConnectionsSettings'

const createOffer = (code: string): OutputFor<'api_gateway.create_pairing_offer'> => ({
  hostname: 'desktop',
  port: 24444,
  addresses: ['192.168.1.8'],
  code,
  expiresAt: Date.now() + 60_000
})

const device = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'My phone',
  platform: 'android',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z'
}

describe('DeviceConnectionsSettings', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [])
    requestMock.mockReset()
    navigateMock.mockReset()
    MockUseCacheUtils.resetMocks()
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
    useIpcOnMock.mockReset()
    useApiGatewayMock.mockReturnValue({
      apiGatewayConfig: { enabled: true, host: '0.0.0.0', port: 23333, apiKey: 'cs-sk-test' },
      apiGatewayRunning: true,
      apiGatewayLoading: false
    })
  })

  it.each([
    [false, false],
    [false, true],
    [true, false]
  ])('opens gateway settings when unavailable (enabled=%s, running=%s)', async (enabled, running) => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayConfig: { enabled, host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-test' },
      apiGatewayRunning: running
    })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('note')).toHaveTextContent(enUS['deviceConnections.toggle.risk'])
    expect(screen.getAllByText(enUS['deviceConnections.gateway.required'])[0]).toBeVisible()
    expect(screen.queryByText(enUS['deviceConnections.pairing.requiresRunning'])).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open API Gateway settings' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/api-gateway' })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('blocks changing LAN access while a gateway command is in flight', () => {
    useApiGatewayMock.mockReturnValue({ ...useApiGatewayMock(), apiGatewayLoading: true })
    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('button', { name: 'Disable LAN access' })).toBeDisabled()
  })

  it.each([true, false])('changes only LAN access when enabled=%s is requested', async (enabled) => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayConfig: { ...useApiGatewayMock().apiGatewayConfig, host: enabled ? '127.0.0.1' : '0.0.0.0' }
    })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: enabled ? 'Enable LAN access' : 'Disable LAN access' }))

    expect(requestMock.mock.calls).toEqual([['api_gateway.lan.set_enabled', { enabled }]])
  })

  it('renders the QR from the Main-owned active endpoint offer', async () => {
    requestMock.mockResolvedValue(createOffer('live-code'))
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    const qr = await screen.findByRole('img', { name: 'Pair a device' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '')).toEqual({
      v: 1,
      t: 'cherry-studio-pair',
      name: 'desktop',
      port: 24444,
      ips: ['192.168.1.8'],
      code: 'live-code'
    })
  })

  it('discards a pre-stop QR response without interrupting the new request after restart', async () => {
    let resolveOld!: (offer: OutputFor<'api_gateway.create_pairing_offer'>) => void
    let resolveNew!: (offer: OutputFor<'api_gateway.create_pairing_offer'>) => void
    requestMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNew = resolve
        })
      )
    const user = userEvent.setup()
    const { rerender } = render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    rerender(<DeviceConnectionsSettings />)
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
    rerender(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    await act(async () => resolveOld(createOffer('old-code')))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show pairing QR code' })).toBeDisabled()

    await act(async () => resolveNew(createOffer('new-code')))

    const qr = screen.getByRole('img', { name: 'Pair a device' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '').code).toBe('new-code')
  })

  it('does not restore a consumed QR when pairing completes before the offer response arrives', async () => {
    let resolveOffer!: (offer: OutputFor<'api_gateway.create_pairing_offer'>) => void
    requestMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOffer = resolve
      })
    )
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    await act(async () => {
      useIpcOnMock.mock.calls.find(([event]) => event === 'api_gateway.pairing_completed')![1]()
    })
    await act(async () => resolveOffer(createOffer('consumed-code')))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show pairing QR code' })).toBeEnabled()
  })

  it('shows loading until an empty device list has actually been fetched', () => {
    MockUseDataApiUtils.mockQueryLoading('/api-gateway/paired-devices')
    const { rerender } = render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText('No devices have been paired yet.')).not.toBeInTheDocument()

    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [])
    rerender(<DeviceConnectionsSettings />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('No devices have been paired yet.')).toBeInTheDocument()
  })

  it('offers retry after a list failure and shows devices when the retry succeeds', async () => {
    const refetch = vi.fn(async () => {
      MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [device])
    })
    MockUseDataApiUtils.mockQueryResult('/api-gateway/paired-devices', {
      error: new Error('Unavailable'),
      refetch
    })
    const user = userEvent.setup()
    const { rerender } = render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load paired devices.')
    expect(screen.queryByText('No devices have been paired yet.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    rerender(<DeviceConnectionsSettings />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('My phone')).toBeInTheDocument()
  })

  it('retries an unavailable LAN listener and keeps recovery available after failure', async () => {
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    requestMock.mockRejectedValueOnce(new Error('disk full'))
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('button', { name: 'Disable LAN access' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(requestMock.mock.calls).toEqual([['api_gateway.lan.set_enabled', { enabled: true }]])
    expect(toast.error).toHaveBeenCalledWith('Failed to change LAN access: disk full')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('removes an expired QR and lets the user request a fresh one', async () => {
    let resolveOffer!: (offer: OutputFor<'api_gateway.create_pairing_offer'>) => void
    requestMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOffer = resolve
      })
    )
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    // Keep Testing Library's post-click timer on the real clock; only simulate QR expiry.
    vi.useFakeTimers()
    await act(async () => resolveOffer(createOffer('expiring-code')))
    expect(screen.getByRole('img', { name: 'Pair a device' })).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(60_000))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show pairing QR code' })).toBeEnabled()
  })

  it.each([true, false])('revokes the selected device and reports success=%s', async (success) => {
    const trigger = vi.fn(async () => {
      if (!success) throw new Error('Unavailable')
      MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [])
    })
    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [device])
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/api-gateway/paired-devices/:id', trigger)
    const user = userEvent.setup()
    const { rerender } = render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.devices.revoke'] }))
    rerender(<DeviceConnectionsSettings />)

    expect(trigger).toHaveBeenCalledWith({ params: { id: device.id } })
    if (success) {
      expect(screen.queryByText(device.name)).not.toBeInTheDocument()
      expect(toast.success).toHaveBeenCalledWith(enUS['deviceConnections.devices.revoked'])
    } else {
      expect(screen.getByText(device.name)).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(enUS['common.delete_failed'])
      expect(screen.getByRole('button', { name: enUS['deviceConnections.devices.revoke'] })).toBeEnabled()
    }
  })
})
