import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import type { MiniAppManifest } from '@shared/types/miniAppManifest'

const APP_ID = 'com.example.mygame'

/** `manifest_json` is `$type<MiniAppManifest>()`, so a partial object does not typecheck. */
const MANIFEST: MiniAppManifest = {
  id: APP_ID,
  name: { en: 'My Game' },
  description: { en: 'A tiny sample game.' },
  version: '1.0.0',
  entry: 'index.html',
  permissions: [],
  optionalPermissions: [],
  network: []
}

const installation = {
  appId: APP_ID,
  version: '1.0.0',
  contentHash: 'sha256:abc',
  source: 'file' as const,
  manifestJson: MANIFEST
}

describe('mini_app_installation', () => {
  const dbh = setupTestDatabase()

  const insertApp = () =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP_ID,
        kind: 'app',
        presetMiniAppId: null,
        name: 'My Game',
        url: `cherry-miniapp://${APP_ID}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  it('cascades when the owning mini app is deleted', () => {
    insertApp()
    dbh.db.insert(miniAppInstallationTable).values(installation).run()

    dbh.db.delete(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).run()

    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(0)
  })

  it('rejects an installation with no owning mini app', () => {
    expect(() => dbh.db.insert(miniAppInstallationTable).values(installation).run()).toThrow()
  })

  it('rejects a web install with no update coordinates', () => {
    insertApp()
    expect(() =>
      dbh.db
        .insert(miniAppInstallationTable)
        .values({ ...installation, source: 'url' })
        .run()
    ).toThrow()
  })

  it('rejects a local install carrying update coordinates', () => {
    insertApp()
    expect(() =>
      dbh.db
        .insert(miniAppInstallationTable)
        .values({ ...installation, sourceUrl: 'https://x/m.json', sourceOrigin: 'https://x' })
        .run()
    ).toThrow()
  })

  it('allows at most one installation per app', () => {
    insertApp()
    dbh.db.insert(miniAppInstallationTable).values(installation).run()
    expect(() => dbh.db.insert(miniAppInstallationTable).values(installation).run()).toThrow()
  })

  it('rejects a half-written rollback snapshot', () => {
    // The four columns are one fact. Three of them is a row that PROMISES a rollback
    // and cannot perform it — and the panel shows the button off exactly that promise.
    insertApp()
    expect(() =>
      dbh.db
        .insert(miniAppInstallationTable)
        .values({ ...installation, previousContentHash: 'sha256:old', previousGrantsJson: ['storage.get'] })
        .run()
    ).toThrow()
  })

  it('accepts a complete rollback snapshot', () => {
    // Negative control: a CHECK that rejects every snapshot also passes the case above.
    insertApp()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        ...installation,
        previousContentHash: 'sha256:old',
        previousManifestJson: { ...MANIFEST, version: '0.9.0' },
        previousGrantsJson: ['storage.get'],
        previousConsentedDeclaredJson: ['storage.get']
      })
      .run()

    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(1)
  })

  it('lets a url install pin a single origin when the manifest declared no accelerator', () => {
    // The CHECK once demanded `source_origin_cn` for every url row; an optional mirror
    // means the column, not the source kind, decides whether it is set.
    insertApp()
    expect(() =>
      dbh.db
        .insert(miniAppInstallationTable)
        .values({
          ...installation,
          source: 'url',
          sourceUrl: 'https://example.com/mygame/manifest.json',
          sourceOrigin: 'https://example.com'
        })
        .run()
    ).not.toThrow()
  })
})

describe('mini_app_grant', () => {
  const dbh = setupTestDatabase()

  const insertApp = () =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP_ID,
        kind: 'app',
        presetMiniAppId: null,
        name: 'My Game',
        url: `cherry-miniapp://${APP_ID}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  const grant = { appId: APP_ID, permission: 'storage.get', grantedVersion: '1.0.0' }

  it('cascades when the owning mini app is deleted', () => {
    insertApp()
    dbh.db.insert(miniAppGrantTable).values(grant).run()

    dbh.db.delete(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).run()

    expect(dbh.db.select().from(miniAppGrantTable).all()).toHaveLength(0)
  })

  it('rejects a duplicate grant for the same permission', () => {
    insertApp()
    dbh.db.insert(miniAppGrantTable).values(grant).run()
    expect(() => dbh.db.insert(miniAppGrantTable).values(grant).run()).toThrow()
  })
})
