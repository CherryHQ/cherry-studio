import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startLogin: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'CherryCloudService') return service
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

import { cherryCloudHandlers } from '../cherryCloud'

describe('cherryCloudHandlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns only the public login status', async () => {
    service.getStatus.mockResolvedValue({ phase: 'signed-in', displayName: 'Sora' })

    await expect(cherryCloudHandlers['cherry_cloud.status.get'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'signed-in',
      displayName: 'Sora'
    })
  })

  it('starts login through the lifecycle service', async () => {
    service.startLogin.mockResolvedValue({ phase: 'authorizing', displayName: null })

    await expect(cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'authorizing',
      displayName: null
    })
  })
})
