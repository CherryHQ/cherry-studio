import { miniAppTable } from '@data/db/schemas/miniapp'
import { MiniAppSeeder } from '@data/db/seeding/seeders/miniAppSeeder'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('MiniAppSeeder', () => {
  const dbh = setupTestDatabase()

  it('should insert all preset miniapps on empty table', async () => {
    const seed = new MiniAppSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(miniAppTable)
    expect(rows).toHaveLength(PRESETS_MINI_APPS.length)
    for (const preset of PRESETS_MINI_APPS) {
      const row = rows.find((r) => r.appId === preset.id)
      expect(row).toBeDefined()
      expect(row?.presetMiniappId).toBe(preset.id)
      expect(row?.name).toBe(preset.name)
      expect(row?.url).toBe(preset.url)
    }
  })

  it('should refresh registry-enrichable fields not in userOverrides on re-run', async () => {
    const preset = PRESETS_MINI_APPS[0]
    await dbh.db.insert(miniAppTable).values({
      appId: preset.id,
      presetMiniappId: preset.id,
      name: 'Stale Name',
      url: preset.url,
      status: 'enabled',
      orderKey: 'a0',
      userOverrides: []
    })

    const seed = new MiniAppSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, preset.id))
    expect(row.name).toBe(preset.name)
  })

  it('should preserve fields listed in userOverrides on re-run', async () => {
    const preset = PRESETS_MINI_APPS[0]
    await dbh.db.insert(miniAppTable).values({
      appId: preset.id,
      presetMiniappId: preset.id,
      name: 'User Custom Name',
      url: preset.url,
      status: 'enabled',
      orderKey: 'a0',
      userOverrides: ['name']
    })

    const seed = new MiniAppSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, preset.id))
    expect(row.name).toBe('User Custom Name')
  })

  it('should not overwrite user-modified status or orderKey on re-run', async () => {
    const preset = PRESETS_MINI_APPS[0]
    await dbh.db.insert(miniAppTable).values({
      appId: preset.id,
      presetMiniappId: preset.id,
      name: preset.name,
      url: preset.url,
      status: 'disabled',
      orderKey: 'z9',
      userOverrides: []
    })

    const seed = new MiniAppSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, preset.id))
    expect(row.status).toBe('disabled')
    expect(row.orderKey).toBe('z9')
  })

  it('should not throw and preserve custom fields when all enrichable fields are overridden', async () => {
    const preset = PRESETS_MINI_APPS[0]
    await dbh.db.insert(miniAppTable).values({
      appId: preset.id,
      presetMiniappId: preset.id,
      name: 'Custom Name',
      url: 'https://custom.example.com',
      status: 'enabled',
      orderKey: 'a0',
      userOverrides: ['name', 'url', 'logo', 'bordered', 'background', 'supportedRegions', 'nameKey']
    })

    const seed = new MiniAppSeeder()
    await expect(seed.run(dbh.db)).resolves.not.toThrow()

    const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, preset.id))
    expect(row.name).toBe('Custom Name')
    expect(row.url).toBe('https://custom.example.com')
  })

  it('should leave custom (non-preset) rows untouched', async () => {
    await dbh.db.insert(miniAppTable).values({
      appId: 'my-custom-app',
      presetMiniappId: null,
      name: 'My Custom',
      url: 'https://custom.app',
      status: 'enabled',
      orderKey: 'a0'
    })

    const seed = new MiniAppSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'my-custom-app'))
    expect(row).toBeDefined()
    expect(row.name).toBe('My Custom')
    expect(row.presetMiniappId).toBeNull()
  })
})
