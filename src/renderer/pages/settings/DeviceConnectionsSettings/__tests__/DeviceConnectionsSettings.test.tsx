import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('react-i18next', () => {
  const t = (key: keyof typeof enUS, options?: { address?: string }) =>
    enUS[key].replace('{{address}}', options?.address ?? '')
  return { useTranslation: () => ({ t }) }
})

import DeviceConnectionsSettings from '../DeviceConnectionsSettings'

const createInvitation = (invitationId: string): OutputFor<'api_gateway.remote.create_invitation'> => ({
  hostname: 'desktop',
  port: 24444,
  addresses: ['192.168.1.8'],
  addressOptions: [{ address: '192.168.1.8', interfaceName: 'en0' }],
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

const browserMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const
const originalMethods = browserMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
beforeAll(() => {
  for (const name of browserMethods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {}
    })
})
afterAll(() => {
  browserMethods.forEach((name, index) => {
    const original = originalMethods[index]
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

describe('DeviceConnectionsSettings', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.stubGlobal('__APP_EDITION__', 'global')
  })

  beforeEach(() => {
    vi.stubGlobal('__APP_EDITION__', 'global')
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [])
    invitationMock.mockReset().mockResolvedValue(createInvitation('default'))
    requestMock.mockReset().mockImplementation(async (name: string) => {
      if (name === 'api_gateway.remote.list_claims') return []
      if (name === 'api_gateway.remote.create_invitation') return invitationMock()
      return undefined
    })
    navigateMock.mockReset()
    MockUseCacheUtils.resetMocks()
    MockUseCacheUtils.setPersistCacheValue('settings.device_connections.step', 'connect')
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
    useIpcOnMock.mockReset()
    useApiGatewayMock.mockReturnValue({
      apiGatewayConfig: { enabled: true, host: '0.0.0.0', port: 23333, apiKey: 'cs-sk-test' },
      apiGatewayRunning: true,
      apiGatewayLoading: false
    })
  })

  it.each([
    {
      edition: 'cn',
      androidDownloadUrl:
        'https://gitcode.com/CherryHQ/cherry-studio-app/releases/download/v0.1.1/cherry-studio-0.1.1-android.apk'
    },
    {
      edition: 'global',
      androidDownloadUrl:
        'https://github.com/CherryHQ/cherry-studio-app/releases/download/v0.1.1/cherry-studio-0.1.1-android.apk'
    }
  ])(
    'uses $edition downloads and preserves steps until onboarding is completed',
    async ({ edition, androidDownloadUrl }) => {
      vi.stubGlobal('__APP_EDITION__', edition)
      MockUseCacheUtils.resetMocks()
      MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
      const user = userEvent.setup()
      const first = render(<DeviceConnectionsSettings />)
      expect(screen.getByRole('button', { name: enUS['deviceConnections.download.ios'] })).toBeVisible()
      expect(screen.queryByText(enUS['deviceConnections.pairing.title'])).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: enUS['deviceConnections.download.ios'] }))
      expect(requestMock).toHaveBeenCalledWith(
        'system.shell.open_external_website',
        'https://testflight.apple.com/join/2ryzjB66'
      )
      expect(screen.getByRole('img', { name: enUS['deviceConnections.download.ios'] })).toHaveAttribute(
        'data-value',
        'https://testflight.apple.com/join/2ryzjB66'
      )
      expect(screen.queryByRole('img', { name: enUS['deviceConnections.download.android'] })).not.toBeInTheDocument()
      await user.click(screen.getByRole('tab', { name: 'Android' }))
      expect(screen.getByRole('tab', { name: 'Android' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('img', { name: enUS['deviceConnections.download.ios'] })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: enUS['deviceConnections.download.android'] }))
      expect(requestMock).toHaveBeenCalledWith('system.shell.open_external_website', androidDownloadUrl)
      expect(screen.getByRole('img', { name: enUS['deviceConnections.download.android'] })).toHaveAttribute(
        'data-value',
        androidDownloadUrl
      )
      await user.click(screen.getByRole('tab', { name: 'iOS' }))
      expect(screen.queryByRole('img', { name: enUS['deviceConnections.download.android'] })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: enUS['deviceConnections.download.ios'] })).toBeVisible()
      expect(requestMock).not.toHaveBeenCalledWith('api_gateway.remote.create_invitation')
      await user.click(screen.getByRole('button', { name: enUS['deviceConnections.guide.continue'] }))
      first.rerender(<DeviceConnectionsSettings />)
      expect(await screen.findByRole('img', { name: enUS['deviceConnections.pairing.title'] })).toHaveAttribute(
        'data-value',
        expect.stringContaining('"invitationId":"default"')
      )
      first.unmount()

      const second = render(<DeviceConnectionsSettings />)
      expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()
      expect(screen.getByText(enUS['deviceConnections.pairing.title'])).toBeVisible()
      await user.click(screen.getByRole('button', { name: enUS['deviceConnections.downloadMobile'] }))
      second.unmount()

      render(<DeviceConnectionsSettings />)
      expect(screen.getByRole('button', { name: enUS['deviceConnections.download.ios'] })).toBeVisible()
      expect(screen.queryByText(enUS['deviceConnections.pairing.title'])).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('keeps the active pairing invitation while downloading the mobile app in a dialog', async () => {
    MockUseCacheUtils.setPersistCacheValue('settings.device_connections.step', 'complete')
    invitationMock.mockResolvedValue(createInvitation('active-invitation'))
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    const pairingQr = await screen.findByRole('img', { name: enUS['deviceConnections.pairing.title'] })
    const payload = pairingQr.getAttribute('data-value')

    const download = screen.getByRole('button', { name: enUS['deviceConnections.downloadMobile'] })
    await user.click(download)
    const dialog = within(screen.getByRole('dialog', { name: enUS['deviceConnections.downloadMobile'] }))
    expect(dialog.getByRole('img', { name: enUS['deviceConnections.download.ios'] })).toBeVisible()
    await user.click(dialog.getByRole('tab', { name: 'Android' }))
    expect(dialog.getByRole('img', { name: enUS['deviceConnections.download.android'] })).toHaveAttribute(
      'data-value',
      'https://github.com/CherryHQ/cherry-studio-app/releases/download/v0.1.1/cherry-studio-0.1.1-android.apk'
    )
    await user.click(dialog.getByRole('button', { name: enUS['common.close'] }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: enUS['deviceConnections.pairing.title'] })).toHaveAttribute(
      'data-value',
      payload
    )
    expect(download).toHaveFocus()
    expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()
  })

  it('skips onboarding for existing devices and stays completed after all devices are removed', async () => {
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.mockQueryLoading('/api-gateway/paired-devices')
    const user = userEvent.setup()
    const view = render(<DeviceConnectionsSettings />)
    expect(screen.getByRole('status')).toHaveTextContent(enUS['common.loading'])
    expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()

    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [device])
    view.rerender(<DeviceConnectionsSettings />)
    expect(screen.getByText(device.name)).toBeVisible()
    expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()
    MockUseDataApiUtils.mockQueryData('/api-gateway/paired-devices', [])
    view.unmount()

    render(<DeviceConnectionsSettings />)
    expect(screen.getByText(enUS['deviceConnections.devices.empty'])).toBeVisible()
    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.downloadMobile'] }))
    expect(screen.getByRole('dialog', { name: enUS['deviceConnections.downloadMobile'] })).toBeVisible()
  })

  it.each(['reject', 'failed approval'])('keeps onboarding unfinished after %s', async (outcome) => {
    requestMock.mockImplementation(async (name: string) => {
      if (name === 'api_gateway.remote.list_claims') return [claim]
      if (name === 'api_gateway.remote.create_invitation') return createInvitation('pending-claim')
      if (name === 'api_gateway.remote.decide_pairing' && outcome === 'failed approval') throw new Error('Unavailable')
      return undefined
    })
    const user = userEvent.setup()
    const first = render(<DeviceConnectionsSettings />)
    await screen.findByRole('group', { name: 'Pairing request' })
    await user.click(screen.getByRole('button', { name: outcome === 'reject' ? 'Reject' : 'Approve' }))
    first.unmount()

    const second = render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.downloadMobile'] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    second.unmount()
    render(<DeviceConnectionsSettings />)
    expect(screen.getByRole('button', { name: enUS['deviceConnections.guide.continue'] })).toBeVisible()
  })

  it('automatically cycles the previews and pauses while the user is looking at them', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)
    const region = screen.getByRole('region', { name: enUS['deviceConnections.showcase.title'] })
    const showcase = within(region)
    expect(showcase.getByRole('img', { name: enUS['deviceConnections.showcase.chat'] })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTime(5000))
    expect(showcase.getByRole('img', { name: enUS['deviceConnections.showcase.agent'] })).toBeInTheDocument()
    await user.hover(region)
    await act(() => vi.advanceTimersByTime(10000))
    expect(showcase.getByRole('img', { name: enUS['deviceConnections.showcase.agent'] })).toBeInTheDocument()
    await user.unhover(region)
    await act(() => vi.advanceTimersByTime(5000))
    expect(showcase.getByRole('img', { name: enUS['deviceConnections.showcase.image'] })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTime(5000))
    expect(showcase.getByRole('img', { name: enUS['deviceConnections.showcase.chat'] })).toBeInTheDocument()
    expect(showcase.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()
  })

  it('uses all ordered addresses in automatic mode and only the selected address without replacing the invitation', async () => {
    const user = userEvent.setup()
    const invitation = createInvitation('address-selection')
    invitation.addresses.push('100.94.33.58')
    invitation.addressOptions.push({ address: '100.94.33.58', interfaceName: 'utun6' })
    invitationMock.mockResolvedValue(invitation)
    render(<DeviceConnectionsSettings />)
    await screen.findByRole('img', { name: 'Pair a device' })
    const qr = () =>
      JSON.parse(screen.getByRole('img', { name: enUS['deviceConnections.pairing.title'] }).getAttribute('data-value')!)
    expect(qr().ips).toEqual(invitation.addresses)
    await user.click(screen.getByRole('combobox', { name: enUS['deviceConnections.pairing.address'] }))
    await user.click(screen.getByRole('option', { name: '100.94.33.58 (utun6)' }))
    expect(qr()).toMatchObject({
      ips: ['100.94.33.58'],
      invitationId: invitation.invitationId,
      invitationSecret: invitation.invitationSecret
    })
    await user.click(screen.getByRole('combobox', { name: enUS['deviceConnections.pairing.address'] }))
    await user.click(screen.getByRole('option', { name: enUS['deviceConnections.pairing.automatic'] }))
    expect(qr().ips).toEqual(invitation.addresses)
  })

  it('lets the user retry a failed automatic invitation without retrying on its own', async () => {
    invitationMock.mockRejectedValueOnce(new Error('Unavailable'))
    render(<DeviceConnectionsSettings />)
    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(invitationMock).toHaveBeenCalledTimes(1)
    invitationMock.mockResolvedValueOnce(createInvitation('retried'))
    await userEvent.setup().click(refresh)
    expect(await screen.findByRole('img', { name: 'Pair a device' })).toBeVisible()
  })

  it('does not restore a stale QR when refreshing addresses fails', async () => {
    const user = userEvent.setup()
    invitationMock.mockResolvedValueOnce(createInvitation('original'))
    render(<DeviceConnectionsSettings />)
    await screen.findByRole('img', { name: 'Pair a device' })
    invitationMock.mockRejectedValueOnce(new Error('No connection address is available'))
    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.pairing.refreshAddresses'] }))
    expect(screen.queryByRole('img', { name: enUS['deviceConnections.pairing.title'] })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS['common.refresh'] })).toBeEnabled()
  })

  it('hides the QR when refresh removes the selected address until the user selects again', async () => {
    const user = userEvent.setup()
    invitationMock.mockResolvedValueOnce(createInvitation('original'))
    render(<DeviceConnectionsSettings />)
    await screen.findByRole('img', { name: 'Pair a device' })
    await user.click(screen.getByRole('combobox', { name: enUS['deviceConnections.pairing.address'] }))
    await user.click(screen.getByRole('option', { name: '192.168.1.8 (en0)' }))
    const refreshed = {
      ...createInvitation('refreshed'),
      addresses: ['100.94.33.58'],
      addressOptions: [{ address: '100.94.33.58', interfaceName: 'utun6' }]
    }
    invitationMock.mockResolvedValueOnce(refreshed)
    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.pairing.refreshAddresses'] }))
    expect(await screen.findByText(enUS['deviceConnections.pairing.addressUnavailable'])).toHaveAttribute(
      'role',
      'alert'
    )
    expect(screen.queryByRole('img', { name: enUS['deviceConnections.pairing.title'] })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: enUS['deviceConnections.pairing.address'] }))
    await user.click(screen.getByRole('option', { name: enUS['deviceConnections.pairing.automatic'] }))
    expect(
      JSON.parse(screen.getByRole('img', { name: enUS['deviceConnections.pairing.title'] }).getAttribute('data-value')!)
        .ips
    ).toEqual(refreshed.addresses)
  })

  it('explains network exposure before enabling device connections', () => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayConfig: { ...useApiGatewayMock().apiGatewayConfig, host: '127.0.0.1' }
    })
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    render(<DeviceConnectionsSettings />)
    expect(screen.getByText(enUS['deviceConnections.toggle.description'])).toBeVisible()
    expect(screen.getByRole('button', { name: 'Allow network access' })).toBeEnabled()
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

    expect(screen.queryByText(enUS['deviceConnections.toggle.risk'])).not.toBeInTheDocument()
    expect(screen.getAllByText(enUS['deviceConnections.gateway.required'])[0]).toBeVisible()
    expect(screen.queryByText(enUS['deviceConnections.pairing.requiresRunning'])).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open API Gateway settings' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/api-gateway' })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('blocks changing LAN access while a gateway command is in flight', () => {
    useApiGatewayMock.mockReturnValue({ ...useApiGatewayMock(), apiGatewayLoading: true })
    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('button', { name: 'Disable network access' })).toBeDisabled()
  })

  it.each([true, false])('changes only LAN access when enabled=%s is requested', async (enabled) => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayConfig: { ...useApiGatewayMock().apiGatewayConfig, host: enabled ? '127.0.0.1' : '0.0.0.0' }
    })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: enabled ? 'Allow network access' : 'Disable network access' }))

    expect(requestMock.mock.calls.filter(([name]) => name === 'api_gateway.lan.set_enabled')).toEqual([
      ['api_gateway.lan.set_enabled', { enabled }]
    ])
  })

  it('automatically renders the QR from the Main-owned invitation', async () => {
    invitationMock.mockResolvedValue(createInvitation('live-invitation'))
    render(<DeviceConnectionsSettings />)

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
    const { rerender } = render(<DeviceConnectionsSettings />)

    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    rerender(<DeviceConnectionsSettings />)
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', true)
    rerender(<DeviceConnectionsSettings />)

    await act(async () => resolveOld(createInvitation('old-invitation')))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeVisible()

    await act(async () => resolveNew(createInvitation('new-invitation')))

    const qr = screen.getByRole('img', { name: 'Pair a device' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '').invitationId).toBe('new-invitation')
  })

  it('approves selected capabilities and remembers onboarding completion after the first pairing', async () => {
    let pending = false
    requestMock.mockImplementation(async (name: string) => {
      if (name === 'api_gateway.remote.create_invitation') return createInvitation('live-invitation')
      if (name === 'api_gateway.remote.list_claims') return pending ? [claim] : []
      return undefined
    })
    const user = userEvent.setup()
    const view = render(<DeviceConnectionsSettings />)
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
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    view.unmount()

    render(<DeviceConnectionsSettings />)
    await user.click(screen.getByRole('button', { name: enUS['deviceConnections.downloadMobile'] }))
    expect(screen.getByRole('dialog', { name: enUS['deviceConnections.downloadMobile'] })).toBeVisible()
    expect(screen.queryByRole('button', { name: enUS['deviceConnections.guide.continue'] })).not.toBeInTheDocument()
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
    requestMock.mockImplementation((name: string) =>
      name === 'api_gateway.remote.list_claims'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve(createInvitation('live'))
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

    expect(screen.getByText(enUS['deviceConnections.devices.loadError'])).toBeVisible()
    expect(screen.queryByText('No devices have been paired yet.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    rerender(<DeviceConnectionsSettings />)

    expect(screen.queryByText(enUS['deviceConnections.devices.loadError'])).not.toBeInTheDocument()
    expect(screen.getByText('My phone')).toBeInTheDocument()
  })

  it('retries an unavailable LAN listener and keeps recovery available after failure', async () => {
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.lan_running', false)
    requestMock.mockRejectedValueOnce(new Error('disk full'))
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('button', { name: 'Disable network access' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(requestMock.mock.calls).toEqual([['api_gateway.lan.set_enabled', { enabled: true }]])
    expect(toast.error).toHaveBeenCalledWith('Failed to change network access: disk full')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('removes an expired QR and lets the user request a fresh one', async () => {
    let resolveInvitation!: (invitation: OutputFor<'api_gateway.remote.create_invitation'>) => void
    invitationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvitation = resolve
      })
    )
    render(<DeviceConnectionsSettings />)

    // Simulate expiry without waiting for the invitation's lifetime.
    vi.useFakeTimers()
    await act(async () => resolveInvitation(createInvitation('expiring-invitation')))
    expect(screen.getByRole('img', { name: 'Pair a device' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(enUS['deviceConnections.toggle.risk'])

    await act(async () => vi.advanceTimersByTime(60_000))

    expect(screen.queryByRole('img', { name: 'Pair a device' })).not.toBeInTheDocument()
    expect(screen.getByText('QR code expired')).toBeVisible()
    expect(invitationMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    invitationMock.mockResolvedValueOnce(createInvitation('fresh'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('img', { name: 'Pair a device' })).toBeVisible()
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
