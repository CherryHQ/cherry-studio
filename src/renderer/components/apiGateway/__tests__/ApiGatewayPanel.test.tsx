import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as SettingsPrimitives from '@renderer/components/SettingsPrimitives'
import en from '@renderer/i18n/locales/en-us.json'

import ApiGatewayPanel from '../ApiGatewayPanel'

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

vi.mock('@renderer/components/SettingsPrimitives', async (importOriginal) => ({
  SettingsPageHeader: (await importOriginal<typeof SettingsPrimitives>()).SettingsPageHeader,
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

vi.mock('react-i18next', async () => {
  const { default: locale } = await import('@renderer/i18n/locales/en-us.json')
  return { useTranslation: () => ({ t: (key: string) => (locale as Record<string, string>)[key] ?? key }) }
})

const gatewayState = () => ({
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

describe('ApiGatewayPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApiGatewayMock.mockReturnValue(gatewayState())
  })

  it('starts and stops the gateway and displays its running address', () => {
    const startApiGateway = vi.fn()
    const stopApiGateway = vi.fn()
    const state = { ...gatewayState(), startApiGateway, stopApiGateway }
    useApiGatewayMock.mockReturnValue(state)
    const { rerender } = render(<ApiGatewayPanel />)
    expect(screen.getByLabelText(en['apiGateway.fields.url.label'])).toHaveValue('http://127.0.0.1:23333')
    expect(screen.getByLabelText(en['apiGateway.fields.port.label'])).toHaveValue('23333')
    fireEvent.click(screen.getByRole('button', { name: en['apiGateway.actions.start'] }))
    expect(startApiGateway).toHaveBeenCalledOnce()
    useApiGatewayMock.mockReturnValue({ ...state, apiGatewayRunning: true })
    rerender(<ApiGatewayPanel />)
    expect(screen.getByText(en['apiGateway.status.running'])).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:23333')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en['apiGateway.actions.stop'] }))
    expect(stopApiGateway).toHaveBeenCalledOnce()
  })

  it('masks the API key until the user reveals it', () => {
    render(<ApiGatewayPanel />)
    const key = screen.getByLabelText(en['apiGateway.fields.apiKey.label'])
    expect(key).toHaveAttribute('type', 'password')
    expect(screen.queryByDisplayValue('Authorization: Bearer cs-sk-test-key')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en['settings.provider.api_key.show_key'] }))
    expect(key).toHaveAttribute('type', 'text')
    expect(screen.getByDisplayValue('Authorization: Bearer cs-sk-test-key')).toBeInTheDocument()
  })
})
