import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'

import { miniAppInstallPath } from '../../paths'

// Records the WORLD at the moment the app goes offline, not the wrapper's own entry
// and exit: deleting first and quiescing after produces the same call order.
// `vi.hoisted` avoids the TDZ on first import.
const spy = vi.hoisted(() => ({ onEntry: undefined as { row: boolean; tree: boolean } | undefined }))

// The static `@application` import above runs this factory before any other import of
// this file is initialised, so the helper has to be loaded from inside it.
vi.mock('../../activityLog', () => ({
  ACTIVITY_COUNT_FLUSH_MS: 60_000,
  miniAppActivityLog: {
    recordCall: vi.fn(),
    recordGrant: vi.fn(),
    flush: vi.fn(async () => {}),
    forget: vi.fn(async () => {})
  }
}))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    MiniAppRuntimeService: {
      withAppQuiesced: vi.fn(async (appId: string, mutate: () => Promise<unknown>) => {
        spy.onEntry = { row: hasRow(appId), tree: fs.existsSync(miniAppInstallPath(appId)) }
        return mutate()
      }),
      forgetApp: vi.fn()
    }
  })
})

// The global electron mock has no `session.fromPartition`, and the REAL uninstall
// clears the app's partition on its way out.
vi.mock('electron', () => ({
  webContents: { fromId: () => undefined },
  session: {
    fromPartition: vi.fn(() => ({
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearCodeCaches: vi.fn().mockResolvedValue(undefined)
    }))
  }
}))

const { uninstallMiniApp } = await import('../../install/installer')

const APP_ID = 'com.example.mygame'

// Through `application.get`, not `dbh`: the hoisted factory runs at module scope where
// the describe-scoped handle does not exist; `setupTestDatabase` points both at one DB.
const hasRow = (appId: string) =>
  application.get('DbService').getDb().select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).all().length > 0

describe('uninstall goes offline first', () => {
  const dbh = setupTestDatabase()
  let root: string

  // The unified mock's `getPath` returns `/mock/<key>`, which no ordinary user can
  // create — this suite writes real files, so point the root at a temp dir.
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-uninstall-'))
    // Key-aware AND filename-aware: ignoring either collapses every journal onto
    // the packages root — `writeFileSync` on a directory.
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const dir = key === 'feature.mini_app.publish_journal' ? path.join(root, '.publish-journal') : root
      return filename ? path.join(dir, filename) : dir
    })
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  // `uninstallMiniApp` is the REAL implementation and throws if there is no row, so an
  // empty database fails before reaching the wrapper under test.
  beforeEach(() => {
    spy.onEntry = undefined
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
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId: APP_ID,
        version: '1.0.0',
        contentHash: 'sha256:x',
        source: 'file',
        manifestJson: {
          id: APP_ID,
          name: { en: 'My Game' },
          description: { en: 'A tiny sample game.' },
          version: '1.0.0',
          entry: 'index.html',
          permissions: [],
          optionalPermissions: [],
          network: []
        }
      })
      .run()
    // The install directory too: uninstall renames the tree away, and `rename` on a
    // missing source fails before any of the logic under test runs.
    fs.mkdirSync(miniAppInstallPath(APP_ID), { recursive: true })
    fs.writeFileSync(path.join(miniAppInstallPath(APP_ID), 'index.html'), '<h1>hi</h1>')
  })

  it('quiesces before it deletes anything', async () => {
    await uninstallMiniApp(APP_ID)

    // Row AND tree still there when the app went offline, both gone when it returns.
    expect(spy.onEntry).toEqual({ row: true, tree: true })
    expect(hasRow(APP_ID)).toBe(false)
    expect(fs.existsSync(miniAppInstallPath(APP_ID))).toBe(false)
  })

  it('drops the attention badge with the app', async () => {
    // The bug this guards: a dot pointing at a row that no longer exists. Lives here
    // rather than in Task 28 because the uninstall path is this file's subject.
    await uninstallMiniApp(APP_ID)

    expect(application.get('MiniAppRuntimeService').forgetApp).toHaveBeenCalledWith(APP_ID)
  })
})
