import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { showErrorDetailPopupMock } = vi.hoisted(() => ({
  showErrorDetailPopupMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Avatar: ({ children }: any) => React.createElement('span', { 'data-testid': 'avatar' }, children),
    AvatarFallback: ({ children }: any) => React.createElement('span', null, children),
    Button: ({ children, disabled, loading, onClick, startContent, ...props }: any) =>
      React.createElement(
        'button',
        { ...props, disabled: disabled || loading, onClick, type: 'button' },
        startContent,
        children
      ),
    Combobox: ({ options = [], onChange, renderOption, renderValue, triggerProps, value }: any) =>
      React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          { ...triggerProps, 'data-testid': 'combobox-trigger', role: 'combobox', type: 'button' },
          renderValue?.(value, options)
        ),
        options.map((option: any) =>
          React.createElement(
            'button',
            { key: option.value, type: 'button', onClick: () => onChange?.(option.value) },
            renderOption ? renderOption(option) : option.label
          )
        )
      ),
    Dialog: ({ children, open }: any) => (open ? React.createElement('div', { role: 'dialog' }, children) : null),
    DialogContent: ({ children }: any) => React.createElement('div', null, children),
    DialogFooter: ({ children }: any) => React.createElement('div', null, children),
    DialogHeader: ({ children }: any) => React.createElement('div', null, children),
    DialogTitle: ({ children }: any) => React.createElement('h2', null, children)
  }
})

vi.mock('@renderer/utils/model', () => ({
  getModelLogo: (model: any) => {
    const React = require('react')

    return model?.icon
      ? {
          Avatar: ({ size }: any) =>
            React.createElement(
              'span',
              { 'data-testid': `model-icon-${model.id}`, 'data-size': size },
              model.name.slice(0, 1)
            )
        }
      : undefined
  }
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  showErrorDetailPopup: showErrorDetailPopupMock
}))

import ProviderConnectionCheckDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer'

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open }: any) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))

describe('ProviderConnectionCheckDrawer', () => {
  const baseProps = {
    open: true,
    models: [],
    apiKeys: [],
    isSubmitting: false,
    onClose: vi.fn(),
    onStart: vi.fn()
  }

  beforeEach(() => {
    showErrorDetailPopupMock.mockClear()
  })

  it('opens model health check from the footer and closes this drawer first', () => {
    const onClose = vi.fn()
    const onOpenModelHealthCheck = vi.fn()

    render(
      <ProviderConnectionCheckDrawer {...baseProps} onClose={onClose} onOpenModelHealthCheck={onOpenModelHealthCheck} />
    )

    const healthCheckButtonName = /Check all models|检测所有模型/

    fireEvent.click(screen.getByRole('button', { name: healthCheckButtonName }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenModelHealthCheck).toHaveBeenCalledTimes(1)
  })

  it('hides the model health check footer action when no handler is provided', () => {
    render(<ProviderConnectionCheckDrawer {...baseProps} />)

    expect(screen.queryByRole('button', { name: /Check all models|检测所有模型/ })).toBeNull()
  })

  it('renders local model options with icons and starts the check with the selected model', () => {
    const alphaModel = { id: 'provider-a::alpha', name: 'Alpha Model', providerId: 'provider-a', icon: true } as any
    const betaModel = { id: 'provider-a::beta', name: 'Beta Search Model', providerId: 'provider-a', icon: true } as any
    const onStart = vi.fn()

    render(
      <ProviderConnectionCheckDrawer
        {...baseProps}
        models={[alphaModel, betaModel]}
        apiKeys={['sk-test']}
        onStart={onStart}
      />
    )

    expect(screen.getByRole('button', { name: /Alpha Model/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Search Model/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('model-icon-provider-a::alpha').length).toBeGreaterThan(0)
    expect(screen.getByRole('combobox', { name: '选择模型' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Beta Search Model/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start|开始/ }))

    expect(onStart).toHaveBeenCalledWith({ model: betaModel, apiKey: 'sk-test' })
  })

  it('selects an api key from the dropdown before starting the check', () => {
    const model = { id: 'provider-a::alpha', name: 'Alpha Model', providerId: 'provider-a' } as any
    const onStart = vi.fn()

    render(
      <ProviderConnectionCheckDrawer
        {...baseProps}
        models={[model]}
        apiKeys={['sk-first', 'sk-second']}
        onStart={onStart}
      />
    )

    expect(screen.getByRole('combobox', { name: '选择要使用的 API 密钥：' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sk.*nd/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start|开始/ }))

    expect(onStart).toHaveBeenCalledWith({ model, apiKey: 'sk-second' })
  })

  it('shows the connection failure message and opens the error detail popup', () => {
    const connectionError = { name: 'HealthCheckError', message: 'invalid api key', stack: null }

    render(<ProviderConnectionCheckDrawer {...baseProps} connectionError={connectionError} />)

    const detailButton = screen.getByRole('button', { name: /invalid api key/ })
    expect(detailButton).toHaveTextContent('invalid api key')

    fireEvent.click(detailButton)

    expect(showErrorDetailPopupMock).toHaveBeenCalledWith({ error: connectionError })
  })

  it('opens the connection failure detail from the keyboard', async () => {
    const connectionError = { name: 'HealthCheckError', message: 'invalid api key', stack: null }
    const user = userEvent.setup()

    render(<ProviderConnectionCheckDrawer {...baseProps} connectionError={connectionError} />)

    const detailButton = screen.getByRole('button', { name: /invalid api key/ })
    await user.tab()
    expect(detailButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(showErrorDetailPopupMock).toHaveBeenCalledWith({ error: connectionError })
  })
})
