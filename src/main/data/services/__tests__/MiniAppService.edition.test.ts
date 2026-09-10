import { miniAppTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api/errors'
import type { AppEdition } from '@shared/types/appEdition'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationEdition, migrationOrigin } = vi.hoisted(() => ({
  applicationEdition: { current: 'cn' as AppEdition },
  migrationOrigin: { current: false }
}))

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => applicationEdition.current }))
vi.mock('@data/migration/v1MigrationOrigin', () => ({ isMigratedFromV1: () => migrationOrigin.current }))

/** `openai` declares `supportedRegions: ['Global']`; `radeon-cloud` declares both. */
const GLOBAL_ONLY_PRESET = 'openai'
const BOTH_EDITIONS_PRESET = 'radeon-cloud'

describe('MiniAppService edition availability', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    applicationEdition.current = 'cn'
    migrationOrigin.current = false
    await dbh.db.insert(miniAppTable).values([
      {
        appId: GLOBAL_ONLY_PRESET,
        presetMiniAppId: GLOBAL_ONLY_PRESET,
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        status: 'enabled',
        orderKey: 'a0'
      },
      {
        appId: BOTH_EDITIONS_PRESET,
        presetMiniAppId: BOTH_EDITIONS_PRESET,
        name: 'AMD GPU Cloud',
        url: 'https://developer.amd.com.cn/radeon/',
        status: 'enabled',
        orderKey: 'a1'
      },
      {
        appId: 'my-own-app',
        presetMiniAppId: null,
        name: 'My own app',
        url: 'https://example.com/',
        status: 'enabled',
        orderKey: 'a2'
      }
    ])
  })

  it('withholds a global-only preset app from every surface in China', () => {
    expect(miniAppService.list().map((app) => app.appId)).toEqual([BOTH_EDITIONS_PRESET, 'my-own-app'])
    expect(() => miniAppService.getByAppId(GLOBAL_ONLY_PRESET)).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
  })

  it('leaves the row untouched so switching back to the global edition restores it', async () => {
    applicationEdition.current = 'global'

    expect(miniAppService.list().map((app) => app.appId)).toContain(GLOBAL_ONLY_PRESET)
    const [persisted] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, GLOBAL_ONLY_PRESET))
    expect(persisted.name).toBe('ChatGPT')
  })

  it('never withholds a user-authored app, which belongs to no catalog', () => {
    expect(miniAppService.getByAppId('my-own-app').appId).toBe('my-own-app')
  })

  it('exempts profiles migrated from v1, matching providers', () => {
    migrationOrigin.current = true

    expect(miniAppService.list().map((app) => app.appId)).toContain(GLOBAL_ONLY_PRESET)
  })
})
