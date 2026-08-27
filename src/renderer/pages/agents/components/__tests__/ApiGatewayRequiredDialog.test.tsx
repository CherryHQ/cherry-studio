import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
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
    MockUsePreferenceUtils.resetMocks()
  })

  it('defers the gateway prompt until the mandatory privacy update is resolved', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.privacy.data_collection.enabled': true,
      'app.privacy.policy_version': 'previous'
    })
    const view = render(<ApiGatewayRequiredDialog sessionId="session-1" />)
    const onGatewayRequired = useIpcOnMock.mock.calls[0]?.[1]

    await act(async () => onGatewayRequired({ sessionId: 'session-1' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    view.rerender(<ApiGatewayRequiredDialog sessionId="session-1" />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
