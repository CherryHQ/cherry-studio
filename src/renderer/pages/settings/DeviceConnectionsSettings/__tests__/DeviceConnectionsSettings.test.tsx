import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'

const { invitationMock, requestMock, navigateMock, useApiGatewayMock, useIpcOnMock } = vi.hoisted(() => ({
  invitationMock: vi.fn(),
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

const createInvitation = (invitationId: string): OutputFor<'api_gateway.remote.create_invitation'> => ({
  hostname: 'desktop',
  port: 24444,
  addresses: ['192.168.1.8'],
  invitationId,
  invitationSecret: 'secret',
  desktopIdentity: '12D3KooWDesktop',
  protocolVersions: [1],
  expiresAt: new Date(Date.now() + 60_000).toISOString()
})

const claim: OutputFor<'api_gateway.remote.list_claims'>[number] = {
  claimId: 'claim-1',
  deviceName: 'My phone',
  platform: 'ios',
  capabilities: ['configuration', 'agent'],
  verificationCode: '123456',
  expiresAt: new Date(Date.now() + 60_000).toISOString()
}

const device = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'My phone',
  platform: 'android',
  remoteAccess: { capabilities: ['agent' as const] },
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
    invitationMock.mockReset()
    requestMock.mockReset().mockImplementation(async (name: string) => {
      if (name === 'api_gateway.remote.list_claims') return []
      if (name === 'api_gateway.remote.create_invitation') return invitationMock()
      return undefined
    })
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

    expect(requestMock.mock.calls.filter(([name]) => name !== 'api_gateway.remote.list_claims')).toEqual([
      ['api_gateway.lan.set_enabled', { enabled }]
    ])
  })

  it('renders the QR from the Main-owned invitation', async () => {
    invitationMock.mockResolvedValue(createInvitation('live-invitation'))
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    const qr = await screen.findByRole('img', { name: 'Pair a device' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '')).toEqual({
      v: 2,
      t: 'cherry-studio-pair',
      name: 'desktop',
      port: 24444,
      ips: ['192.168.1.8'],
      invitationId: 'live-invitation',
      invitationSecret: 'secret',
      desktopIdentity: '12D3KooWDesktop',
      protocolVersions: [1]
    })
  })

  it('discards a pre-stop QR response without interrupting the new request after restart', async () => {
    let resolveOld!: (invitation: OutputFor<'api_gateway.remote.create_invitation'>) => void
    let resolveNew!: (invitation: OutputFor<'api_gateway.remote.create_invitation'>) => void
    invitationMock
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

    await act(async () => resolveOld(createInvitation('old-invitation')))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show pairing QR code' })).toBeDisabled()

    await act(async () => resolveNew(createInvitation('new-invitation')))

    const qr = screen.getByRole('img', { name: 'Pair a device' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '').invitationId).toBe('new-invitation')
  })

  it('replaces the QR with the claim and approves only the capabilities left checked', async () => {
    let pending = false
    requestMock.mockImplementation(async (name: string) => {
      if (name === 'api_gateway.remote.create_invitation') return createInvitation('live-invitation')
      if (name === 'api_gateway.remote.list_claims') return pending ? [claim] : []
      return undefined
    })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))
    await screen.findByRole('img', { name: 'Pair a device' })
    pending = true

    await act(async () => {
      useIpcOnMock.mock.calls.find(([event]) => event === 'api_gateway.remote.pairing_changed')![1]()
    })

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Pairing request' })).toHaveTextContent('123456')
    await user.click(screen.getByRole('checkbox', { name: 'Import providers and models' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(requestMock).toHaveBeenCalledWith('api_gateway.remote.decide_pairing', {
      claimId: 'claim-1',
      capabilities: ['agent']
    })
    expect(toast.success).toHaveBeenCalledWith('Device paired')
    expect(screen.queryByRole('group', { name: 'Pairing request' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show pairing QR code' })).toBeEnabled()
  })

  it('loads a pending claim on mount and rejects it without granting anything', async () => {
    requestMock.mockImplementation(async (name: string) =>
      name === 'api_gateway.remote.list_claims' ? [claim] : undefined
    )
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    expect(await screen.findByRole('group', { name: 'Pairing request' })).toHaveTextContent('123456')

    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(requestMock).toHaveBeenCalledWith('api_gateway.remote.decide_pairing', {
      claimId: 'claim-1',
      capabilities: null
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not restore claims from a request started before the LAN listener stopped', async () => {
    let resolve!: (claims: (typeof claim)[]) => void
    requestMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const { rerender } = render(<DeviceConnectionsSettings />)
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    rerender(<DeviceConnectionsSettings />)
    await act(async () => resolve([claim]))
    expect(screen.queryByRole('group', { name: 'Pairing request' })).not.toBeInTheDocument()
  })

  it('keeps a newer pairing event result when the mount query finishes late', async () => {
    let resolve!: (claims: (typeof claim)[]) => void
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue([])
    render(<DeviceConnectionsSettings />)
    await act(async () => {
      useIpcOnMock.mock.calls.find(([event]) => event === 'api_gateway.remote.pairing_changed')![1]()
    })
    await act(async () => resolve([claim]))
    expect(screen.queryByRole('group', { name: 'Pairing request' })).not.toBeInTheDocument()
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
    let resolveInvitation!: (invitation: OutputFor<'api_gateway.remote.create_invitation'>) => void
    invitationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvitation = resolve
      })
    )
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: 'Show pairing QR code' }))

    // Keep Testing Library's post-click timer on the real clock; only simulate QR expiry.
    vi.useFakeTimers()
    await act(async () => resolveInvitation(createInvitation('expiring-invitation')))
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
