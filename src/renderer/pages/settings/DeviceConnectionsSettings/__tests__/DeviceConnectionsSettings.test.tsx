import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, setConfigMock, startGatewayMock, stopGatewayMock, useApiGatewayMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  setConfigMock: vi.fn(),
  startGatewayMock: vi.fn(),
  stopGatewayMock: vi.fn(),
  useApiGatewayMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: ComponentProps<'button'> & { loading?: boolean }) => (
    <button type="button" disabled={loading} {...props}>
      {children}
    </button>
  ),
  IndicatorLight: () => <span />,
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: Omit<ComponentProps<'input'>, 'checked' | 'onChange'> & {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
  useMutation: () => ({ trigger: vi.fn(), isLoading: false }),
  useQuery: () => ({ data: [], refetch: vi.fn() })
}))

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
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock }, useIpcOn: vi.fn() }))
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ title, value }: { title: string; value: string }) => (
    <output role="img" aria-label={title} data-value={value} />
  )
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import DeviceConnectionsSettings from '../DeviceConnectionsSettings'

describe('DeviceConnectionsSettings', () => {
  beforeEach(() => {
    requestMock.mockReset()
    setConfigMock.mockReset()
    startGatewayMock.mockReset()
    stopGatewayMock.mockReset()
    useApiGatewayMock.mockReturnValue({
      apiGatewayConfig: { enabled: true, host: '0.0.0.0', port: 23333, apiKey: 'cs-sk-test' },
      apiGatewayRunning: false,
      apiGatewayLoading: false,
      startApiGateway: startGatewayMock,
      stopApiGateway: stopGatewayMock,
      setApiGatewayConfig: setConfigMock
    })
  })

  it('shows the plain-HTTP risk notice before LAN access is enabled', () => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayConfig: { enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-test' }
    })

    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('note')).toHaveTextContent('deviceConnections.toggle.risk')
  })

  it('blocks LAN config changes while a gateway command is in flight', () => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayLoading: true
    })

    render(<DeviceConnectionsSettings />)

    expect(screen.getByRole('switch', { name: 'deviceConnections.toggle.label' })).toBeDisabled()
  })

  it('renders the QR from the Main-owned active endpoint offer', async () => {
    useApiGatewayMock.mockReturnValue({
      ...useApiGatewayMock(),
      apiGatewayRunning: true
    })
    requestMock.mockResolvedValue({
      success: true,
      hostname: 'desktop',
      port: 24444,
      addresses: ['192.168.1.8'],
      code: 'live-code',
      expiresAt: Date.now() + 60_000
    })
    const user = userEvent.setup()
    render(<DeviceConnectionsSettings />)

    await user.click(screen.getByRole('button', { name: 'deviceConnections.pairing.show' }))

    const qr = await screen.findByRole('img', { name: 'deviceConnections.pairing.title' })
    expect(JSON.parse(qr.getAttribute('data-value') ?? '')).toEqual({
      v: 1,
      t: 'cherry-studio-pair',
      name: 'desktop',
      port: 24444,
      ips: ['192.168.1.8'],
      code: 'live-code'
    })
  })
})
