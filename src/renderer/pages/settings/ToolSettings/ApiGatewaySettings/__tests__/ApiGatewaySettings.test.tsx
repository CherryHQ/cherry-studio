import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiGatewaySettings from '../ApiGatewaySettings'

const useApiGatewayMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()

  return {
    ...actual,
    Button: ({ children, ...props }: ComponentProps<'button'> & { loading?: boolean }) => {
      const { loading, ...buttonProps } = props
      return (
        <button type="button" data-loading={loading || undefined} {...buttonProps}>
          {children}
        </button>
      )
    },
    IndicatorLight: () => <span />,
    Input: (props: ComponentProps<'input'>) => <input {...props} />,
    InputGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputGroupAddon: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputGroupButton: ({
      asChild,
      children,
      type = 'button',
      ...props
    }: ComponentProps<'button'> & { asChild?: boolean }) =>
      asChild ? (
        children
      ) : (
        <button type={type} {...props}>
          {children}
        </button>
      ),
    InputGroupInput: (props: ComponentProps<'input'>) => <input {...props} />,
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})

vi.mock('@renderer/components/CopyButton', () => ({
  default: ({
    textToCopy,
    successFeedback,
    ...props
  }: ComponentProps<'button'> & {
    textToCopy: string
    successFeedback?: 'toast' | 'icon'
  }) => {
    void successFeedback
    return <button type="button" data-copy-text={textToCopy} {...props} />
  }
}))

vi.mock('@renderer/components/icons/GatewayIcon', () => ({
  GatewayIcon: () => <span />
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingGroup: ({ children }: PropsWithChildren) => <section>{children}</section>,
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

const gatewayState = () => ({
  apiGatewayConfig: {
    host: '127.0.0.1',
    port: 23333,
    apiKey: 'cs-sk-test-key',
    enabled: false
  },
  apiGatewayRunning: false,
  apiGatewayLoading: false,
  getApiGatewayRuntimeAddress: vi.fn().mockResolvedValue(null),
  startApiGateway: vi.fn(),
  stopApiGateway: vi.fn(),
  restartApiGateway: vi.fn(),
  setApiGatewayConfig: vi.fn()
})

describe('ApiGatewaySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApiGatewayMock.mockReturnValue(gatewayState())
  })

  // A port is an identifier: an out-of-range one has to be refused and explained,
  // not quietly rounded into range the way a magnitude would be.
  it.each([
    ['999', 'below the minimum'],
    ['70000', 'above the maximum']
  ])('refuses the port %s (%s) and says why', (value) => {
    const setApiGatewayConfig = vi.fn()
    useApiGatewayMock.mockReturnValue({ ...gatewayState(), setApiGatewayConfig })
    render(<ApiGatewaySettings />)

    const field = screen.getByLabelText('apiGateway.fields.port.label')
    fireEvent.change(field, { target: { value } })
    fireEvent.blur(field)

    expect(setApiGatewayConfig).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('apiGateway.messages.portInvalid')
    expect(field).toHaveValue('23333')
  })

  it('restores the saved port when the field is emptied, without calling it invalid', () => {
    const setApiGatewayConfig = vi.fn()
    useApiGatewayMock.mockReturnValue({ ...gatewayState(), setApiGatewayConfig })
    render(<ApiGatewaySettings />)

    const field = screen.getByLabelText('apiGateway.fields.port.label')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)

    expect(field).toHaveValue('23333')
    expect(setApiGatewayConfig).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('applies a port inside the allowed range', () => {
    const setApiGatewayConfig = vi.fn()
    useApiGatewayMock.mockReturnValue({ ...gatewayState(), setApiGatewayConfig })
    render(<ApiGatewaySettings />)

    const field = screen.getByLabelText('apiGateway.fields.port.label')
    fireEvent.change(field, { target: { value: '8080' } })
    fireEvent.blur(field)

    expect(setApiGatewayConfig).toHaveBeenCalledWith({ port: 8080 })
    expect(toast.error).not.toHaveBeenCalled()
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

  it('shows connection fields only while the gateway is stopped', () => {
    const stoppedState = useApiGatewayMock()
    const { rerender } = render(<ApiGatewaySettings />)

    expect(screen.getByRole('textbox', { name: 'apiGateway.fields.url.label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'apiGateway.actions.regenerate' })).toBeInTheDocument()

    useApiGatewayMock.mockReturnValue({
      ...stoppedState,
      apiGatewayConfig: { ...stoppedState.apiGatewayConfig, enabled: true },
      apiGatewayRunning: true
    })
    rerender(<ApiGatewaySettings />)

    expect(screen.queryByRole('textbox', { name: 'apiGateway.fields.url.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'apiGateway.actions.regenerate' })).not.toBeInTheDocument()
  })

  it('displays and opens the port the fallback listener bound', async () => {
    const user = userEvent.setup()
    useApiGatewayMock.mockReturnValue({
      ...gatewayState(),
      apiGatewayConfig: {
        host: '127.0.0.1',
        port: 23333,
        apiKey: 'cs-sk-test-key',
        enabled: true
      },
      apiGatewayRunning: true,
      getApiGatewayRuntimeAddress: vi.fn().mockResolvedValue({ host: '127.0.0.1', port: 24444 })
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ApiGatewaySettings />)

    expect(await screen.findByText('http://127.0.0.1:24444')).toBeInTheDocument()
    expect(screen.queryByText('http://127.0.0.1:23333')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'apiGateway.documentation.title' }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('http://127.0.0.1:24444/openapi', '_blank')
    open.mockRestore()
  })

  it('hides action icons while gateway actions are loading', () => {
    const stoppedState = useApiGatewayMock()
    useApiGatewayMock.mockReturnValue({
      ...stoppedState,
      apiGatewayConfig: { ...stoppedState.apiGatewayConfig, enabled: true },
      apiGatewayRunning: true,
      apiGatewayLoading: true
    })

    render(<ApiGatewaySettings />)

    expect(screen.getByRole('button', { name: 'apiGateway.actions.restart.button' }).querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'apiGateway.actions.stop' }).querySelector('svg')).toBeNull()
  })
})
