// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { fileEntryTable } from '@data/db/schemas/file'
import { providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { getSingleFileRefId } from '@data/services/utils/entityImageRef'
import { providerLogoRef } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const rowFor = (dbh: ReturnType<typeof setupTestDatabase>, providerId: string) =>
  dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))

describe('ProviderService logo (key/file columns)', () => {
  const dbh = setupTestDatabase()

  it('round-trips a preset-key logo set on create', async () => {
    const created = providerService.create({
      providerId: 'p-logo',
      name: 'P',
      logo: { kind: 'key', key: 'icon:openai' }
    })

    expect(created.logo).toBe('icon:openai')
    const [row] = await rowFor(dbh, 'p-logo')
    expect(row.logoKey).toBe('icon:openai')
  })

  it('leaves the logo null when create omits it', async () => {
    const created = providerService.create({ providerId: 'p-nologo', name: 'P' })

    expect(created.logo).toBeUndefined()
    const [row] = await rowFor(dbh, 'p-nologo')
    expect(row.logoKey).toBeNull()
  })

  it('sets a key logo on update', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'p-set', name: 'P', orderKey: 'a0' })

    const updated = providerService.update('p-set', { logo: { kind: 'key', key: 'icon:openai' } })

    expect(updated.logo).toBe('icon:openai')
    const [row] = await rowFor(dbh, 'p-set')
    expect(row.logoKey).toBe('icon:openai')
  })

  it('resets the logo when update sends { kind: default } (row null → entity undefined)', async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'p-default', name: 'P', orderKey: 'a0', logoKey: 'icon:old' })

    const updated = providerService.update('p-default', { logo: { kind: 'default' } })

    expect(updated.logo).toBeUndefined()
    const [row] = await rowFor(dbh, 'p-default')
    expect(row.logoKey).toBeNull()
  })

  it('leaves the logo unchanged when omitted from the patch', async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'p-keep', name: 'P', orderKey: 'a0', logoKey: 'icon:keep' })

    providerService.update('p-keep', { name: 'Renamed' })

    const [row] = await rowFor(dbh, 'p-keep')
    expect(row.logoKey).toBe('icon:keep')
  })

  // An uploaded logo lives ONLY in the single-file `provider_logo_file_ref` slot
  // (the source of truth); the owner row keeps no `logo_file_id`. These lock in
  // the read side: `getSingleFileRefId` looks the id back up, and the DTO surfaces it
  // as a resolved `logoSrc` (mutually exclusive with the preset `logo` key). The
  // set-logo command orchestrator binds an already-minted file_entry via update().
  describe('uploaded logo (file_ref slot is the source of truth)', () => {
    const FILE_ID = '019606a0-0000-7000-8000-0000000000aa'
    const FILE_ID_2 = '019606a0-0000-7000-8000-0000000000bb'

    const logoSlot = (providerId: string) => ({ sourceType: providerLogoRef.sourceType, sourceId: providerId })

    /** Pre-store a file_entry the way the set-logo command would, so the FK + ref pass. */
    const seedFileEntry = (id: string) =>
      dbh.db.insert(fileEntryTable).values({ id, origin: 'internal', name: 'logo', ext: 'webp', size: 3 })

    const logoRefs = (providerId: string) =>
      dbh.db.select().from(providerLogoFileRefTable).where(eq(providerLogoFileRefTable.sourceId, providerId))

    it('binds an uploaded logo to the slot ref, nulls logoKey, and resolves logoSrc on read-back', async () => {
      await seedFileEntry(FILE_ID)
      providerService.create({ providerId: 'p-file', name: 'P' })

      const updated = providerService.update('p-file', { logo: { kind: 'file', fileId: FILE_ID } })

      // The file id lives only in the ref row; the owner row keeps no key.
      const [row] = await rowFor(dbh, 'p-file')
      expect(row.logoKey).toBeNull()
      expect(getSingleFileRefId(logoSlot('p-file'))).toBe(FILE_ID)
      const refs = await logoRefs('p-file')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID)

      // Read model exposes the upload as a resolved file:// URL on `logoSrc`, with
      // the preset `logo` key staying clear — on the update return and a fresh read.
      expect(updated.logo).toBeUndefined()
      expect(updated.logoSrc).toBe(`file:///mock/files/${FILE_ID}.webp`)
      const readBack = providerService.getByProviderId('p-file')
      expect(readBack.logo).toBeUndefined()
      expect(readBack.logoSrc).toBe(`file:///mock/files/${FILE_ID}.webp`)
    })

    it('switching an uploaded logo to a preset key clears the slot ref and preserves the file_entry', async () => {
      await seedFileEntry(FILE_ID)
      providerService.create({ providerId: 'p-file2key', name: 'P' })
      providerService.update('p-file2key', { logo: { kind: 'file', fileId: FILE_ID } })

      const updated = providerService.update('p-file2key', { logo: { kind: 'key', key: 'icon:openai' } })

      const [row] = await rowFor(dbh, 'p-file2key')
      expect(row.logoKey).toBe('icon:openai')
      expect(updated.logo).toBe('icon:openai')
      expect(updated.logoSrc).toBeUndefined()
      expect(getSingleFileRefId(logoSlot('p-file2key'))).toBeNull()
      expect(await logoRefs('p-file2key')).toHaveLength(0)
      // DB-only: the file_entry is preserved (no permanentDelete), per file policy.
      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, FILE_ID))
      expect(entry).toBeTruthy()
    })

    it('replacing one uploaded logo with another repoints the slot ref', async () => {
      await seedFileEntry(FILE_ID)
      await seedFileEntry(FILE_ID_2)
      providerService.create({ providerId: 'p-refile', name: 'P' })
      providerService.update('p-refile', { logo: { kind: 'file', fileId: FILE_ID } })

      providerService.update('p-refile', { logo: { kind: 'file', fileId: FILE_ID_2 } })

      expect(getSingleFileRefId(logoSlot('p-refile'))).toBe(FILE_ID_2)
      const refs = await logoRefs('p-refile')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID_2)
    })
  })
})
