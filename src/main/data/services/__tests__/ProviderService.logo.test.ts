// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const rowFor = (dbh: ReturnType<typeof setupTestDatabase>, providerId: string) =>
  dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))

describe('ProviderService logo (key/file columns)', () => {
  const dbh = setupTestDatabase()

  it('round-trips a preset-key logo set on create', async () => {
    const created = await providerService.create({
      providerId: 'p-logo',
      name: 'P',
      logo: { kind: 'key', key: 'icon:openai' }
    })

    expect(created.logo).toBe('icon:openai')
    const [row] = await rowFor(dbh, 'p-logo')
    expect(row.logoKey).toBe('icon:openai')
  })

  it('leaves the logo null when create omits it', async () => {
    const created = await providerService.create({ providerId: 'p-nologo', name: 'P' })

    expect(created.logo).toBeUndefined()
    const [row] = await rowFor(dbh, 'p-nologo')
    expect(row.logoKey).toBeNull()
  })

  it('sets a key logo on update', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'p-set', name: 'P', orderKey: 'a0' })

    const updated = await providerService.update('p-set', { logo: { kind: 'key', key: 'icon:openai' } })

    expect(updated.logo).toBe('icon:openai')
    const [row] = await rowFor(dbh, 'p-set')
    expect(row.logoKey).toBe('icon:openai')
  })

  it('resets the logo when update sends { kind: default } (row null → entity undefined)', async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'p-default', name: 'P', orderKey: 'a0', logoKey: 'icon:old' })

    const updated = await providerService.update('p-default', { logo: { kind: 'default' } })

    expect(updated.logo).toBeUndefined()
    const [row] = await rowFor(dbh, 'p-default')
    expect(row.logoKey).toBeNull()
  })

  it('leaves the logo unchanged when omitted from the patch', async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'p-keep', name: 'P', orderKey: 'a0', logoKey: 'icon:keep' })

    await providerService.update('p-keep', { name: 'Renamed' })

    const [row] = await rowFor(dbh, 'p-keep')
    expect(row.logoKey).toBe('icon:keep')
  })
})
