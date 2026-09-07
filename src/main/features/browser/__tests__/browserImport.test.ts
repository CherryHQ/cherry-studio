import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importBrowserData } from '../import/importBrowserData'
import { ImportedCookieSchema, matchesImportDomain, parsePortableBrowserData } from '../import/portableBrowserData'
import { withBrowserSnapshot } from '../import/sqliteSnapshot'

describe('Portable browser data parsing', () => {
  it('preserves host-only cookies, subdomain scope, HTTP-only flags, and session expiry', () => {
    const data = parsePortableBrowserData(
      '# Netscape HTTP Cookie File\n#HttpOnly_example.com\tFALSE\t/\tTRUE\t0\tsid\tfixture\n.example.com\tTRUE\t/app\tFALSE\t2000000000\tpref\tvalue'
    )
    expect(data.cookies.map((raw) => ImportedCookieSchema.parse(raw))).toEqual([
      {
        domain: 'example.com',
        name: 'sid',
        value: 'fixture',
        path: '/',
        secure: true,
        httpOnly: true,
        expires: undefined
      },
      {
        domain: '.example.com',
        name: 'pref',
        value: 'value',
        path: '/app',
        secure: false,
        httpOnly: false,
        expires: 2000000000
      }
    ])
    expect(matchesImportDomain('sub.example.com', ['EXAMPLE.COM'])).toBe(true)
    expect(matchesImportDomain('notexample.com', ['example.com'])).toBe(false)
    expect(matchesImportDomain('example.com.attacker.test', ['example.com'])).toBe(false)
    expect(() => parsePortableBrowserData('example.com\tmaybe\t/\tTRUE\t0\tname\tvalue')).toThrow()
  })

  it('keeps malformed storage-state entries isolated for per-item reporting', () => {
    const data = parsePortableBrowserData(
      JSON.stringify({
        cookies: [
          { domain: 'example.com', name: 'sid', value: 'fixture' },
          { domain: 'example.com', name: 'bad', value: null }
        ],
        origins: [{ origin: 'https://example.com', localStorage: [{ name: 'theme', value: 'dark' }] }]
      })
    )
    expect(data.cookies.map((cookie) => ImportedCookieSchema.safeParse(cookie).success)).toEqual([true, false])
    expect(data.origins).toHaveLength(1)
    expect(() => parsePortableBrowserData('{ invalid JSON')).toThrow()
  })
})

describe('Foreign browser SQLite import', () => {
  setupTestDatabase()
  let root: string
  let source: Database.Database | undefined
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'browser-import-fixture-'))
    await mkdir(path.join(root, 'chrome', 'Default'), { recursive: true })
    await mkdir(path.join(root, 'temp'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      path.join(root, key.startsWith('external.browser.') ? key.split('.').at(-1)! : 'temp', filename ?? '')
    )
    const target = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    Object.assign(target, {
      cookies: { set: vi.fn(async () => undefined), flushStore: vi.fn(async () => undefined) },
      flushStorageData: vi.fn()
    })
  })
  afterEach(async () => {
    source?.close()
    source = undefined
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('includes uncheckpointed WAL visits, preserves timestamps, deduplicates reimports and cleans snapshots', async () => {
    source = new Database(path.join(root, 'chrome', 'Default', 'History'))
    source.pragma('journal_mode = WAL')
    source.pragma('wal_autocheckpoint = 0')
    // These are external Chromium tables, not a substitute for production migrations.
    source.exec(
      'CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT); CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)'
    )
    source.prepare('INSERT INTO urls VALUES (?, ?, ?)').run(1, 'https://example.com/report', 'Imported report')
    source.prepare('INSERT INTO visits VALUES (?, ?, ?)').run(1, 1, 11644473600000000 + 1234000)
    const options = { sourceId: 'chrome:Default', history: true, cookies: true, localStorage: false, domains: [] }
    const result = await importBrowserData(options, undefined, new AbortController().signal)
    expect(result.history).toEqual({ imported: 1, skipped: 0, failed: 0, unsupported: false })
    expect(result.cookies.unsupported).toBe(true)
    expect(browserHistoryService.list({ offset: 0, limit: 10 }).items).toMatchObject([
      { url: 'https://example.com/report', title: 'Imported report', visitedAt: 1234, source: 'chrome:Default' }
    ])
    expect((await importBrowserData(options, undefined, new AbortController().signal)).history).toMatchObject({
      imported: 0,
      skipped: 1
    })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it('cleans a snapshot on cancellation or reader failure without modifying the source', async () => {
    source = new Database(path.join(root, 'chrome', 'Default', 'History'))
    source.exec("CREATE TABLE external_fixture (value TEXT); INSERT INTO external_fixture VALUES ('retained')")
    await expect(
      withBrowserSnapshot(source.name, new AbortController().signal, async () => {
        throw new Error('fixture reader failed')
      })
    ).rejects.toThrow('fixture reader failed')
    await expect(withBrowserSnapshot(source.name, AbortSignal.abort(), async () => undefined)).rejects.toThrow()
    expect(source.prepare('SELECT value FROM external_fixture').get()).toEqual({ value: 'retained' })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it('does not turn encrypted or partitioned Chromium cookies into ordinary cookies', async () => {
    source = new Database(path.join(root, 'chrome', 'Default', 'Cookies'))
    source.exec(
      'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, encrypted_value BLOB, top_frame_site_key TEXT)'
    )
    const insert = source.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('example.com', 'ordinary', 'fixture', '/', 0, 1, 1, 1, Buffer.alloc(0), '')
    insert.run('example.com', 'encrypted', '', '/', 0, 1, 1, 1, Buffer.from('encrypted-fixture'), '')
    insert.run('example.com', 'partitioned', 'fixture', '/', 0, 1, 1, 0, Buffer.alloc(0), 'https://top.test')
    const result = await importBrowserData(
      { sourceId: 'chrome:Default', history: false, cookies: true, localStorage: false, domains: [] },
      undefined,
      new AbortController().signal
    )
    expect(result.cookies).toEqual({ imported: 1, skipped: 2, failed: 0, unsupported: true })
    expect(source.prepare('SELECT COUNT(*) AS count FROM cookies').get()).toEqual({ count: 3 })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })
})
