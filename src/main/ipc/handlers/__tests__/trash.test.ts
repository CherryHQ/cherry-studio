import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { trashHandlers } from '../trash'

const trashService = {
  purgeNow: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'TrashService') return trashService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// trash handlers act on shared business data, not the caller's window, so they
// ignore IpcContext — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('trashHandlers', () => {
  it('purge_now delegates to TrashService and returns { jobId, status }', async () => {
    trashService.purgeNow.mockResolvedValue({ jobId: 'job-1', status: 'completed' })

    const result = await trashHandlers['trash.purge_now'](undefined, ctx)

    expect(trashService.purgeNow).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ jobId: 'job-1', status: 'completed' })
  })
})
