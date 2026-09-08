import { MandatoryGateProvider } from '@renderer/components/MandatoryGateProvider'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiGatewayRequiredDialog } from '../ApiGatewayRequiredDialog'

const { useIpcOnMock } = vi.hoisted(() => ({
  useIpcOnMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ useIpcOn: useIpcOnMock }))
vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({ startApiGateway: vi.fn() })
}))

describe('ApiGatewayRequiredDialog', () => {
  beforeEach(() => {
    useIpcOnMock.mockReset()
  })

  it('defers the gateway prompt while a mandatory gate owns the window', async () => {
    const view = render(
      <MandatoryGateProvider open>
        <ApiGatewayRequiredDialog sessionId="session-1" />
      </MandatoryGateProvider>
    )
    const onGatewayRequired = useIpcOnMock.mock.calls[0]?.[1]

    await act(async () => onGatewayRequired({ sessionId: 'session-1' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(
      <MandatoryGateProvider open={false}>
        <ApiGatewayRequiredDialog sessionId="session-1" />
      </MandatoryGateProvider>
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
