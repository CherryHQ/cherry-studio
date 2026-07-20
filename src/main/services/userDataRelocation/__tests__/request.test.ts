import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assertPathsMock, assertRequestMock, bootConfigGetMock, bootConfigPersistMock, bootConfigSetMock } = vi.hoisted(
  () => ({
    assertPathsMock: vi.fn(),
    assertRequestMock: vi.fn(),
    bootConfigGetMock: vi.fn(),
    bootConfigPersistMock: vi.fn(),
    bootConfigSetMock: vi.fn()
  })
)

vi.mock('@application', () => ({
  application: { getPath: vi.fn((key: string) => (key === 'app.userdata' ? '/old/data' : '/mock/path')) }
}))
vi.mock('@main/core/preboot/userDataLocation', () => ({
  canonicalizeUserDataPath: (value: string) => value
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { get: bootConfigGetMock, set: bootConfigSetMock, persist: bootConfigPersistMock }
}))
vi.mock('../validation', () => ({
  RelocationValidationError: class RelocationValidationError extends Error {},
  assertRelocationPaths: assertPathsMock,
  assertUserDataRelocationRequest: assertRequestMock
}))

import { requestUserDataRelocation } from '../request'

let relocationState: unknown

beforeEach(() => {
  vi.clearAllMocks()
  relocationState = null
  bootConfigGetMock.mockImplementation(() => relocationState)
  bootConfigSetMock.mockImplementation((_key: string, value: unknown) => {
    relocationState = value
  })
})

describe('userDataRelocation request', () => {
  it('persists a pending relocation through BootConfigService before relaunch', () => {
    requestUserDataRelocation('/new/data', true)

    const pending = {
      status: 'pending',
      taskId: expect.any(String),
      from: '/old/data',
      to: '/new/data',
      copy: true
    }
    expect(assertRequestMock).toHaveBeenCalledWith(pending)
    expect(bootConfigSetMock).toHaveBeenCalledWith('temp.user_data_relocation', pending)
    expect(bootConfigPersistMock).toHaveBeenCalledTimes(1)
    // BootConfig validates taskId as z.uuid() on set — guard the format here.
    const taskId = (assertRequestMock.mock.calls[0][0] as { taskId: string }).taskId
    expect(taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('restores the previous state when the pending request cannot be persisted', () => {
    bootConfigPersistMock.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() => requestUserDataRelocation('/new/data', true)).toThrow('disk full')

    expect(relocationState).toBeNull()
    expect(bootConfigSetMock).toHaveBeenLastCalledWith('temp.user_data_relocation', null)
  })

  it('writes nothing when request validation rejects the target', () => {
    assertRequestMock.mockImplementationOnce(() => {
      throw new Error('copy target must be empty')
    })

    expect(() => requestUserDataRelocation('/new/data', true)).toThrow('copy target must be empty')

    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(bootConfigPersistMock).not.toHaveBeenCalled()
  })
})
