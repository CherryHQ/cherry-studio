import type * as CherryStudioUI from '@cherrystudio/ui'
import { MandatoryGateProvider } from '@renderer/components/MandatoryGateProvider'
import i18n from '@renderer/i18n/resolver'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiGatewayRequiredDialog } from '../ApiGatewayRequiredDialog'

const { startApiGatewayMock, useIpcOnMock } = vi.hoisted(() => ({
  startApiGatewayMock: vi.fn(),
  useIpcOnMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ useIpcOn: useIpcOnMock }))
vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({ startApiGateway: startApiGatewayMock })
}))
vi.mock('@cherrystudio/ui', async () => vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui'))

describe('ApiGatewayRequiredDialog', () => {
  beforeEach(() => {
    useIpcOnMock.mockReset()
    startApiGatewayMock.mockReset()
    startApiGatewayMock.mockResolvedValue(true)
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

  it('keeps the gateway prompt open when enabling fails', async () => {
    const user = userEvent.setup()
    startApiGatewayMock.mockResolvedValue(false)
    render(
      <MandatoryGateProvider open={false}>
        <ApiGatewayRequiredDialog sessionId="session-1" />
      </MandatoryGateProvider>
    )
    const onGatewayRequired = useIpcOnMock.mock.calls[0]?.[1]
    await act(async () => onGatewayRequired({ sessionId: 'session-1' }))

    await user.click(screen.getByRole('button', { name: i18n.t('apiGateway.required.confirm') }))

    expect(startApiGatewayMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
