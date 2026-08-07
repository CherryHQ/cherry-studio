import { preferenceService } from '@data/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { restoreFromNutstore } from '../NutstoreService'

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  restoreFromWebdav: vi.fn()
}))

describe('restoreFromNutstore', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await preferenceService.set('data.backup.nutstore.token', 'encrypted-token')
    await preferenceService.set('data.backup.nutstore.path', '/cherry-studio')
    mocks.decryptToken.mockResolvedValue({ username: 'user', access_token: 'access-token' })
    Object.assign(window.api, {
      backup: { restoreFromWebdav: mocks.restoreFromWebdav },
      nutstore: { decryptToken: mocks.decryptToken }
    })
  })

  it('propagates restore failures to the backup manager UI', async () => {
    const error = new Error('Unsupported backup version')
    mocks.restoreFromWebdav.mockRejectedValue(error)

    await expect(restoreFromNutstore('backup.zip')).rejects.toBe(error)
  })
})
