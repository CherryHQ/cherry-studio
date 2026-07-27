import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiGatewaySettings from '../ApiGatewaySettings'

const useApiGatewayMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'> & { loading?: boolean }) => {
    const { loading, ...buttonProps } = props
    return (
      <button type="button" data-loading={loading || undefined} {...buttonProps}>
        {children}
      </button>
    )
  },
  ButtonGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  IndicatorLight: () => <span />,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  InputGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  InputGroupAddon: ({ children }: PropsWithChildren) => <div>{children}</div>,
  InputGroupInput: (props: ComponentProps<'input'>) => <input {...props} />,
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/icons/GatewayIcon', () => ({
  GatewayIcon: () => <span />
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsContentColumn: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => useApiGatewayMock()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('ApiGatewaySettings', () => {
  beforeEach(() => {
    useApiGatewayMock.mockReturnValue({
      apiGatewayConfig: {
        host: '127.0.0.1',
        port: 23333,
        apiKey: 'cs-sk-test-key',
        enabled: false
      },
      apiGatewayRunning: false,
      apiGatewayLoading: false,
      startApiGateway: vi.fn(),
      stopApiGateway: vi.fn(),
      restartApiGateway: vi.fn(),
      setApiGatewayConfig: vi.fn()
    })
  })

  it('protects the API key and authorization header by default', () => {
    render(<ApiGatewaySettings />)

    expect(screen.getByDisplayValue('cs-sk-test-key')).toHaveAttribute('type', 'password')
    // Authorization header keeps the readable "Authorization: Bearer" prefix and masks only the key
    expect(screen.queryByDisplayValue('Authorization: Bearer cs-sk-test-key')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue(/Authorization: Bearer •/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.provider.api_key.show_key' })).toBeInTheDocument()
  })

  it('reveals and hides the API key fields together', () => {
    render(<ApiGatewaySettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_key.show_key' }))

    expect(screen.getByDisplayValue('cs-sk-test-key')).toHaveAttribute('type', 'text')
    expect(screen.getByDisplayValue('Authorization: Bearer cs-sk-test-key')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_key.hide_key' }))

    expect(screen.getByDisplayValue('cs-sk-test-key')).toHaveAttribute('type', 'password')
    expect(screen.queryByDisplayValue('Authorization: Bearer cs-sk-test-key')).not.toBeInTheDocument()
  })
})
