import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as keyStore from '../import/browserCookieKey'
import { listBrowserProfiles } from '../import/browserProfiles'
import { CookieImportError } from '../import/CookieImportError'
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

  it('discovers Chrome, Dia and Comet independently even when their profile names match', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    for (const browser of ['chrome', 'dia', 'comet']) {
      await mkdir(path.join(root, browser, 'Default'), { recursive: true })
      await writeFile(path.join(root, browser, 'Default', 'History'), '')
      await writeFile(path.join(root, browser, 'Default', 'Cookies'), '')
    }
    expect(await listBrowserProfiles()).toMatchObject([
      { id: 'chrome:Default', browser: 'chrome', history: true, cookies: 'requires_authorization' },
      { id: 'dia:Default', browser: 'dia', history: true, cookies: 'requires_authorization' },
      { id: 'comet:Default', browser: 'comet', history: true, cookies: 'requires_authorization' }
    ])
  })

  it('detects Opera root and named profiles without treating cache folders as profiles', async () => {
    await mkdir(path.join(root, 'opera', 'Default', 'Network'), { recursive: true })
    await mkdir(path.join(root, 'opera', 'Cache'), { recursive: true })
    await writeFile(path.join(root, 'opera', 'History'), '')
    await writeFile(path.join(root, 'opera', 'Default', 'Network', 'Cookies'), '')
    await writeFile(path.join(root, 'opera', 'Cache', 'Cookies'), '')
    expect((await listBrowserProfiles()).map(({ id, history, cookies }) => ({ id, history, cookies }))).toEqual([
      { id: 'opera:root', history: true, cookies: 'unavailable' },
      { id: 'opera:Default', history: false, cookies: 'requires_authorization' }
    ])
  })

  it('reads profile names and accounts without changing source identity or exposing other metadata', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    await writeFile(path.join(root, 'chrome', 'Default', 'History'), '')
    const stateFile = path.join(root, 'chrome', 'Local State')
    await writeFile(
      stateFile,
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: ' Work ', user_name: ' user@example.com ', gaia_name: 'Full Name', gaia_id: 'private-id' }
          }
        },
        os_crypt: { encrypted_key: 'private-key' }
      })
    )
    const [before] = await listBrowserProfiles()
    expect(before).toMatchObject({
      id: 'chrome:Default',
      profile: 'Default',
      displayName: 'Work',
      account: 'user@example.com'
    })
    expect(JSON.stringify(before)).not.toContain('private-')
    await writeFile(stateFile, JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' } } } }))
    const [after] = await listBrowserProfiles()
    expect(after).toMatchObject({ id: before.id, profile: 'Default', displayName: 'Personal' })
    expect(after.account).toBeUndefined()
  })

  it.each(['{invalid', '{}', '{"profile":{"info_cache":{"Default":null}}}'])(
    'keeps profiles available when optional metadata is malformed: %s',
    async (metadata) => {
      await writeFile(path.join(root, 'chrome', 'Default', 'History'), '')
      await writeFile(path.join(root, 'chrome', 'Local State'), metadata)
      const [profile] = await listBrowserProfiles()
      expect(profile).toMatchObject({ id: 'chrome:Default', profile: 'Default', history: true })
      expect(profile.displayName).toBeUndefined()
      expect(profile.account).toBeUndefined()
    }
  )

  it.each([
    ['win32', ['comet:Default']],
    ['linux', []]
  ] as const)('only discovers supported new browser sources on %s', async (platform, expected) => {
    vi.spyOn(os, 'platform').mockReturnValue(platform)
    for (const browser of ['dia', 'comet']) {
      await mkdir(path.join(root, browser, 'Default'), { recursive: true })
      await writeFile(path.join(root, browser, 'Default', 'History'), '')
    }
    expect((await listBrowserProfiles()).map((profile) => profile.id)).toEqual(expected)
  })

  it.each([
    ['chrome', 'Default'],
    ['dia', 'Default'],
    ['comet', 'Default'],
    ['vivaldi', 'Default'],
    ['chromium', 'Profile 1'],
    ['opera', ''],
    ['opera', 'Default']
  ])(
    'imports %s/%s WAL history with source identity, timestamps and reimport deduplication',
    async (browser, profile) => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin')
      await mkdir(path.join(root, browser, profile), { recursive: true })
      source = new Database(path.join(root, browser, profile, 'History'))
      source.pragma('journal_mode = WAL')
      source.pragma('wal_autocheckpoint = 0')
      // These are external Chromium tables, not a substitute for production migrations.
      source.exec(
        'CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT); CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)'
      )
      source.prepare('INSERT INTO urls VALUES (?, ?, ?)').run(1, 'https://example.com/report', 'Imported report')
      source.prepare('INSERT INTO visits VALUES (?, ?, ?)').run(1, 1, 11644473600000000 + 1234000)
      const options = {
        sourceId: `${browser}:${profile || 'root'}`,
        history: true,
        cookies: true,
        localStorage: false,
        domains: []
      }
      const result = await importBrowserData(options, undefined, new AbortController().signal)
      expect(result.history).toEqual({ imported: 1, skipped: 0, failed: 0, unsupported: false })
      expect(result.cookies.unsupported).toBe(true)
      expect(browserHistoryService.list({ offset: 0, limit: 10 }).items).toMatchObject([
        {
          url: 'https://example.com/report',
          title: 'Imported report',
          visitedAt: 1234,
          source: `${browser}:${profile || 'root'}`
        }
      ])
      expect((await importBrowserData(options, undefined, new AbortController().signal)).history).toMatchObject({
        imported: 0,
        skipped: 1
      })
      expect(await readdir(path.join(root, 'temp'))).toEqual([])
    }
  )

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

  it('does not turn unknown encryption or partitioned Chromium cookies into ordinary cookies', async () => {
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
    expect(result.cookies).toEqual({
      imported: 1,
      skipped: 2,
      failed: 0,
      unsupported: true,
      reasons: { unsupported_encryption: 1, partitioned: 1 }
    })
    expect(source.prepare('SELECT COUNT(*) AS count FROM cookies').get()).toEqual({ count: 3 })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it('imports real encrypted cookies, filters before accessing keys and isolates corrupt values', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    const password = vi
      .spyOn(keyStore, 'readBrowserCookiePassword')
      .mockRejectedValue(new Error('must not access keyring'))
    source = new Database(path.join(root, 'chrome', 'Default', 'Cookies'))
    source.pragma('journal_mode = WAL')
    source.exec(
      "CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24'); CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, encrypted_value BLOB, top_frame_site_key TEXT)"
    )
    const insert = source.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const bound = Buffer.from('djEwG7ZUgz+m+KcxUo25LWV9w3yHVEqBunh10GgSc1Q7Tk8sjVwXWsZ4L5bXikdaxyFH', 'base64')
    insert.run('.example.com', 'session', '', '/', 0, 1, 1, 1, bound, '')
    insert.run(
      '.example.com',
      'empty',
      '',
      '/',
      0,
      1,
      0,
      2,
      Buffer.from('djEwG7ZUgz+m+KcxUo25LWV9w3yHVEqBunh10GgSc1Q7Tk8Xy+h5l+h2DB/7sRfHAPZT', 'base64'),
      ''
    )
    insert.run('example.com', 'wrong-host', '', '/', 0, 1, 1, 1, bound, '')
    insert.run('.example.com', 'expired', '', '/', 11644473600000000 + 1000000, 1, 1, 1, Buffer.from('v11fixture'), '')
    insert.run('.excluded.test', 'filtered', '', '/', 0, 1, 1, 1, Buffer.from('v11fixture'), '')
    insert.run('.example.com', 'partitioned', '', '/', 0, 1, 1, 1, Buffer.from('v11fixture'), 'https://top.test')
    const result = await importBrowserData(
      { sourceId: 'chrome:Default', history: false, cookies: true, localStorage: false, domains: ['example.com'] },
      undefined,
      new AbortController().signal
    )
    expect(result.cookies).toEqual({
      imported: 2,
      skipped: 3,
      failed: 1,
      unsupported: true,
      reasons: { decryption_failed: 1, expired: 1, partitioned: 1 }
    })
    const target = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    expect(vi.mocked(target.cookies.set).mock.calls.map(([cookie]) => cookie)).toEqual([
      {
        url: 'https://example.com/',
        domain: '.example.com',
        name: 'session',
        value: 'fixture-value',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax'
      },
      {
        url: 'https://example.com/',
        domain: '.example.com',
        name: 'empty',
        value: '',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'strict'
      }
    ])
    expect(password).not.toHaveBeenCalled()
    expect(source.prepare('SELECT encrypted_value FROM cookies WHERE name = ?').get('session')).toEqual({
      encrypted_value: bound
    })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it('continues importing plaintext after denied key access and reports each affected cookie', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const password = vi
      .spyOn(keyStore, 'readBrowserCookiePassword')
      .mockRejectedValue(new CookieImportError('access_denied'))
    source = new Database(path.join(root, 'chrome', 'Default', 'Cookies'))
    source.exec(
      "CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24'); CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, encrypted_value BLOB)"
    )
    const insert = source.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('example.com', 'first', '', '/', 0, 1, 1, 1, Buffer.from('v10fixture'))
    insert.run('example.com', 'second', '', '/', 0, 1, 1, 1, Buffer.from('v10fixture'))
    insert.run('example.com', 'plain', 'value', '/', 0, 1, 1, 1, Buffer.alloc(0))
    const result = await importBrowserData(
      { sourceId: 'chrome:Default', history: false, cookies: true, localStorage: false, domains: [] },
      undefined,
      new AbortController().signal
    )
    expect(result.cookies).toEqual({
      imported: 1,
      skipped: 2,
      failed: 0,
      unsupported: true,
      reasons: { access_denied: 2 }
    })
    expect(password).toHaveBeenCalledTimes(1)
    expect(source.prepare('SELECT COUNT(*) AS count FROM cookies').get()).toEqual({ count: 3 })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it('returns partial counts and removes the snapshot when cancelled during key access', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const abort = new AbortController()
    const password = Buffer.from('fixture-key')
    vi.spyOn(keyStore, 'readBrowserCookiePassword').mockImplementation(async () => {
      abort.abort()
      return password
    })
    source = new Database(path.join(root, 'chrome', 'Default', 'Cookies'))
    source.exec(
      "CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24'); CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, encrypted_value BLOB)"
    )
    const insert = source.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('example.com', 'plain', 'fixture', '/', 0, 1, 1, 1, Buffer.alloc(0))
    insert.run('example.com', 'encrypted', '', '/', 0, 1, 1, 1, Buffer.from('v10fixture'))
    const result = await importBrowserData(
      { sourceId: 'chrome:Default', history: false, cookies: true, localStorage: false, domains: [] },
      undefined,
      abort.signal
    )
    expect(result.cancelled).toBe(true)
    expect(result.cookies).toEqual({ imported: 1, skipped: 0, failed: 0, unsupported: false })
    expect(password).toEqual(Buffer.alloc(password.length))
    expect(source.prepare('SELECT COUNT(*) AS count FROM cookies').get()).toEqual({ count: 2 })
    expect(await readdir(path.join(root, 'temp'))).toEqual([])
  })

  it.each([15, 16])('preserves Firefox cookie expiration for schema %i', async (version) => {
    await mkdir(path.join(root, 'firefox', 'fixture'), { recursive: true })
    source = new Database(path.join(root, 'firefox', 'fixture', 'cookies.sqlite'))
    source.pragma(`user_version = ${version}`)
    source.exec(
      'CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)'
    )
    source
      .prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('example.com', 'sid', 'fixture', '/', 2000000000 * (version >= 16 ? 1000 : 1), 1, 1, 1, '')
    const result = await importBrowserData(
      { sourceId: 'firefox:fixture', history: false, cookies: true, localStorage: false, domains: [] },
      undefined,
      new AbortController().signal
    )
    expect(result.cookies).toEqual({ imported: 1, skipped: 0, failed: 0, unsupported: false })
    const target = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    expect(vi.mocked(target.cookies.set).mock.calls[0][0]).toMatchObject({
      value: 'fixture',
      expirationDate: 2000000000
    })
  })
})
