import ProviderConnectionCheckDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
})
