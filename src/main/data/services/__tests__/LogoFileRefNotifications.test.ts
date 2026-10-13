import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import * as dataChange from '@data/dataApiDataChange'
import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { miniAppService } from '@data/services/MiniAppService'
import { providerService } from '@data/services/ProviderService'
import type { LogoBindInput } from '@data/services/utils/singleFileRef'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'

const OLD_FILE = '019606a0-0000-7000-8000-0000000000aa'
const NEW_FILE = '019606a0-0000-7000-8000-0000000000bb'
const OWNER = 'com.example.logo'
const sources = ['provider', 'site', 'installed'] as const
type Source = (typeof sources)[number]

describe('Logo file reference notifications', () => {
  const dbh = setupTestDatabase()
  afterEach(() => vi.restoreAllMocks())

  function bind(source: Source, logo: LogoBindInput) {
    if (source === 'provider') providerService.update(OWNER, { logo })
    else if (source === 'site') miniAppService.update(OWNER, { logo })
    else miniAppService.setInstalledLogo(OWNER, logo)
  }

  function seed(source: Source, withLogo = true) {
    for (const id of [OLD_FILE, NEW_FILE]) {
      dbh.db.insert(fileEntryTable).values({ id, origin: 'internal', name: 'logo', ext: 'webp', size: 3 }).run()
    }
    if (source === 'provider') providerService.create({ providerId: OWNER, name: 'Logo owner' })
    else if (source === 'site') miniAppService.create({ appId: OWNER, name: 'Logo owner', url: 'https://example.com' })
    else {
      dbh.db
        .insert(miniAppTable)
        .values({
          appId: OWNER,
          kind: 'app',
          name: 'Logo owner',
          url: `cherry-miniapp://${OWNER}/index.html`,
          status: 'enabled',
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .insert(miniAppInstallationTable)
        .values({
          appId: OWNER,
          version: '1.0.0',
          contentHash: 'sha256:fixture',
          source: 'file',
          manifestJson: {
            id: OWNER,
            name: { en: 'Logo owner' },
            description: { en: 'Test app' },
            version: '1.0.0',
            entry: 'index.html',
            permissions: [],
            optionalPermissions: [],
            network: []
          }
        })
        .run()
    }
    if (withLogo) bind(source, { kind: 'file', fileId: OLD_FILE })
  }

  function observe() {
    const effects: DataApiDataChangeEffect[] = []
    vi.spyOn(dataChange, 'notifyDataApiDataChange').mockImplementation((batch) => {
      expect(dbh.sqlite.inTransaction).toBe(false)
      effects.push(...batch)
    })
    return effects
  }

  function expectFileEffects(effects: DataApiDataChangeEffect[], ids: string[]) {
    for (const endpoint of ['/files/entries', '/files/entries/ref-counts']) {
      const effect = effects.find((item) => item.endpoint === endpoint)
      expect(effect?.kind).toBe(endpoint === '/files/entries' ? 'membership' : 'projection')
      expect(effect?.entityIds?.toSorted()).toEqual(ids.toSorted())
    }
  }

  describe.each(sources)('%s logo', (source) => {
    it.each(['default', 'key', 'file'] as const)('invalidates committed usage when changed to %s', (kind) => {
      seed(source)
      const effects = observe()
      bind(
        source,
        kind === 'file' ? { kind, fileId: NEW_FILE } : kind === 'key' ? { kind, key: 'application' } : { kind }
      )

      expectFileEffects(effects, kind === 'file' ? [OLD_FILE, NEW_FILE] : [OLD_FILE])
      expect(fileEntryService.listCursor({ usage: 'unreferenced' }).items.map((entry) => entry.id)).toContain(OLD_FILE)
      expect(fileEntryService.listCursor({ usage: 'other' }).items.map((entry) => entry.id)).toEqual(
        kind === 'file' ? [NEW_FILE] : []
      )
    })

    it('invalidates a newly referenced file after binding an upload', () => {
      seed(source, false)
      const effects = observe()
      bind(source, { kind: 'file', fileId: NEW_FILE })
      expectFileEffects(effects, [NEW_FILE])
      expect(fileRefService.countByEntryIds([NEW_FILE]).get(NEW_FILE)).toBe(1)
    })

    it('keeps the old logo and emits nothing on rollback', () => {
      seed(source)
      const effects = observe()
      const dbService = application.get('DbService')
      const withWriteTx = dbService.withWriteTx.bind(dbService)
      vi.spyOn(dbService, 'withWriteTx').mockImplementationOnce((fn) =>
        withWriteTx((tx) => {
          fn(tx)
          throw new Error('abort logo change')
        })
      )
      expect(() => bind(source, { kind: 'default' })).toThrow('abort logo change')
      expect(fileRefService.countByEntryIds([OLD_FILE]).get(OLD_FILE)).toBe(1)
      expect(effects).toEqual([])
    })

    it('does not invalidate unchanged file usage', () => {
      seed(source)
      const effects = observe()
      bind(source, { kind: 'file', fileId: OLD_FILE })
      if (source === 'provider') providerService.update(OWNER, { name: 'Renamed' })
      else miniAppService.update(OWNER, { status: 'disabled' })
      expect(fileRefService.countByEntryIds([OLD_FILE]).get(OLD_FILE)).toBe(1)
      expect(effects).toEqual([])
    })
  })

  describe.each(['provider', 'site'] as const)('%s deletion', (source) => {
    const remove = () => (source === 'provider' ? providerService.delete(OWNER) : miniAppService.delete(OWNER))

    it.each([false, true])('invalidates the removed logo reference with shared=%s', (shared) => {
      seed(source)
      if (shared) {
        providerService.create({ providerId: 'shared', name: 'Other owner' })
        providerService.update('shared', { logo: { kind: 'file', fileId: OLD_FILE } })
      }
      const effects = observe()
      remove()
      expectFileEffects(effects, [OLD_FILE])
      expect(fileRefService.countByEntryIds([OLD_FILE]).get(OLD_FILE) ?? 0).toBe(shared ? 1 : 0)
      expect(
        fileEntryService.listCursor({ usage: shared ? 'other' : 'unreferenced' }).items.map((entry) => entry.id)
      ).toContain(OLD_FILE)
    })

    it('rolls back the owner and its logo without invalidation', () => {
      seed(source)
      const effects = observe()
      const dbService = application.get('DbService')
      const withWriteTx = dbService.withWriteTx.bind(dbService)
      vi.spyOn(dbService, 'withWriteTx').mockImplementationOnce((fn) =>
        withWriteTx((tx) => {
          fn(tx)
          throw new Error('abort owner deletion')
        })
      )
      expect(remove).toThrow('abort owner deletion')
      expect(fileRefService.countByEntryIds([OLD_FILE]).get(OLD_FILE)).toBe(1)
      expect(effects).toEqual([])
    })
  })
})
