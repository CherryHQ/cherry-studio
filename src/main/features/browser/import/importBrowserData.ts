import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'

import { browserHistoryService, type BrowserVisitInput } from '@data/services/BrowserHistoryService'
import type { BrowserImportOptions, BrowserImportReason, BrowserImportResult } from '@shared/ipc/schemas/browserImport'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { session, WebContentsView } from 'electron'

import { GuestSession } from '../session/GuestSession'
import { importBrowserFavicons } from './browserFavicons'
import { listBrowserProfiles } from './browserProfiles'
import { ChromiumCookieDecryptor } from './ChromiumCookieDecryptor'
import { CookieImportError } from './CookieImportError'
import {
  ImportedCookieSchema,
  ImportedOriginSchema,
  matchesImportDomain,
  parsePortableBrowserData
} from './portableBrowserData'
import { withBrowserSnapshot } from './sqliteSnapshot'

export function emptyImportResult(): BrowserImportResult {
  return {
    cancelled: false,
    history: { imported: 0, skipped: 0, failed: 0, unsupported: false },
    cookies: { imported: 0, skipped: 0, failed: 0, unsupported: false },
    localStorage: { imported: 0, skipped: 0, failed: 0, unsupported: false }
  }
}

export async function importBrowserData(
  options: BrowserImportOptions,
  file: string | undefined,
  signal: AbortSignal
): Promise<BrowserImportResult> {
  const result = emptyImportResult()
  const target = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
  const cookieIssue = (reason: BrowserImportReason, failed = false) => {
    const category = result.cookies
    category[failed ? 'failed' : 'skipped']++
    category.reasons ??= {}
    category.reasons[reason] = (category.reasons[reason] ?? 0) + 1
    if (reason !== 'expired' && !failed) category.unsupported = true
  }
  const applyCookie = async (raw: unknown) => {
    signal.throwIfAborted()
    if (raw && typeof raw === 'object' && 'partitionKey' in raw) {
      cookieIssue('partitioned')
      return
    }
    const parsed = ImportedCookieSchema.safeParse(raw)
    if (!parsed.success) {
      result.cookies.failed++
      return
    }
    const cookie = parsed.data
    if (!matchesImportDomain(cookie.domain, options.domains)) {
      result.cookies.skipped++
      return
    }
    if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires <= Date.now() / 1000) {
      cookieIssue('expired')
      return
    }
    try {
      const host = cookie.domain.replace(/^\./, '')
      const url = new URL(normalizeBrowserUrl(`${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`))
      if (url.hostname !== host || url.pathname !== cookie.path) throw new Error('Invalid cookie domain or path')
      await target.cookies.set({
        url: url.href,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        ...(cookie.expires && cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
        sameSite:
          cookie.sameSite === 'None'
            ? 'no_restriction'
            : cookie.sameSite === 'Strict'
              ? 'strict'
              : cookie.sameSite === 'Lax'
                ? 'lax'
                : 'unspecified'
      })
      result.cookies.imported++
    } catch {
      result.cookies.failed++
    }
  }
  const applyOrigin = async (raw: unknown) => {
    signal.throwIfAborted()
    const parsed = ImportedOriginSchema.safeParse(raw)
    if (!parsed.success) {
      result.localStorage.failed++
      return
    }
    const { origin, localStorage } = parsed.data
    let url: URL
    try {
      url = new URL(normalizeBrowserUrl(origin))
      if (url.origin !== origin) throw new Error('Expected an origin')
    } catch {
      result.localStorage.failed += localStorage.length || 1
      return
    }
    if (!matchesImportDomain(url.hostname, options.domains)) {
      result.localStorage.skipped += localStorage.length
      return
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false
      }
    })
    const guest = view.webContents
    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
    const commands = new GuestSession(guest, 'borrowed')
    const abort = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    const close = () => {
      if (!guest.isDestroyed()) guest.close()
    }
    abort.addEventListener('abort', close, { once: true })
    let processed = 0
    try {
      abort.throwIfAborted()
      await guest.loadURL(origin)
      if (new URL(guest.getURL()).origin !== origin) throw new Error('Import origin redirected')
      for (const item of localStorage) {
        abort.throwIfAborted()
        try {
          await commands.send(
            'DOMStorage.setDOMStorageItem',
            { storageId: { securityOrigin: origin, isLocalStorage: true }, key: item.name, value: item.value },
            { signal: abort }
          )
          result.localStorage.imported++
        } catch {
          result.localStorage.failed++
        }
        processed++
      }
    } catch {
      result.localStorage.failed += Math.max(0, localStorage.length - processed)
    } finally {
      abort.removeEventListener('abort', close)
      commands.dispose()
      close()
    }
  }

  try {
    if (options.sourceId) {
      const profile = (await listBrowserProfiles()).find((value) => value.id === options.sourceId)
      if (!profile) throw new Error('Browser profile is no longer available')
      if (options.localStorage) result.localStorage.unsupported = true
      if (options.history) {
        const iconPages = new Map<string, string>()
        if (!profile.historyFile) result.history.unsupported = true
        else
          try {
            await withBrowserSnapshot(profile.historyFile, signal, async (db) => {
              const statement =
                profile.browser === 'firefox'
                  ? "SELECT v.id, p.url, COALESCE(p.title, '') AS title, CAST(v.visit_date / 1000 AS INTEGER) AS visitedAt FROM moz_historyvisits v JOIN moz_places p ON v.place_id = p.id ORDER BY v.visit_date DESC, v.id DESC"
                  : "SELECT v.id, u.url, COALESCE(u.title, '') AS title, CAST(v.visit_time / 1000 - 11644473600000 AS INTEGER) AS visitedAt FROM visits v JOIN urls u ON v.url = u.id ORDER BY v.visit_time DESC, v.id DESC"
              let batch: BrowserVisitInput[] = []
              const flush = () => {
                const imported = browserHistoryService.importVisits(batch)
                result.history.imported += imported
                result.history.skipped += batch.length - imported
                batch = []
              }
              let count = 0
              for (const row of db
                .prepare<[], { id: number; url: string; title: string; visitedAt: number }>(statement)
                .iterate()) {
                signal.throwIfAborted()
                if (++count % 500 === 0) {
                  flush()
                  await setImmediate()
                }
                try {
                  if (!matchesImportDomain(new URL(row.url).hostname, options.domains)) {
                    result.history.skipped++
                    continue
                  }
                  const origin = new URL(row.url).origin
                  if (iconPages.size < 256 && !iconPages.has(origin)) iconPages.set(origin, row.url)
                  const sourceKey = createHash('sha256')
                    .update(JSON.stringify([profile.directory, row.id, row.url, row.visitedAt]))
                    .digest('hex')
                  batch.push({
                    url: row.url,
                    title: row.title,
                    visitedAt: row.visitedAt,
                    source: profile.id,
                    sourceKey
                  })
                } catch {
                  result.history.skipped++
                }
              }
              flush()
            })
          } catch {
            signal.throwIfAborted()
            result.history.failed++
          }
        await importBrowserFavicons(profile, [...iconPages.values()], signal)
      }
      if (options.cookies) {
        if (!profile.cookiesFile) result.cookies.unsupported = true
        else
          try {
            await withBrowserSnapshot(profile.cookiesFile, signal, async (db) => {
              const firefox = profile.browser === 'firefox'
              const databaseVersion = firefox
                ? Number(db.pragma('user_version', { simple: true }))
                : db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()
                  ? Number(
                      db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'version'").get()?.value
                    )
                  : 0
              const decryptor =
                profile.browser === 'firefox'
                  ? undefined
                  : new ChromiumCookieDecryptor(profile.browser, databaseVersion, signal)
              const hasPartitionKey =
                !firefox &&
                (db.pragma('table_info(cookies)') as { name: string }[]).some(
                  (column) => column.name === 'top_frame_site_key'
                )
              const statement = firefox
                ? 'SELECT host AS domain, name, value, path, expiry AS expires, isSecure AS secure, isHttpOnly AS httpOnly, sameSite, originAttributes FROM moz_cookies'
                : 'SELECT host_key AS domain, name, value, path, expires_utc AS expires, is_secure AS secure, is_httponly AS httpOnly, samesite AS sameSite, encrypted_value' +
                  (hasPartitionKey ? ', top_frame_site_key AS originAttributes' : '') +
                  ' FROM cookies'
              try {
                let count = 0
                for (const row of db
                  .prepare<
                    [],
                    {
                      domain: string
                      name: string
                      value: string
                      path: string
                      expires: number
                      secure: number
                      httpOnly: number
                      sameSite: number
                      encrypted_value?: Buffer
                      originAttributes?: string
                    }
                  >(statement)
                  .iterate()) {
                  signal.throwIfAborted()
                  if (++count % 500 === 0) await setImmediate()
                  if (!matchesImportDomain(row.domain, options.domains)) {
                    result.cookies.skipped++
                    continue
                  }
                  const expires = row.expires
                    ? firefox
                      ? row.expires / (databaseVersion >= 16 ? 1000 : 1)
                      : row.expires / 1_000_000 - 11644473600
                    : undefined
                  if (expires !== undefined && expires <= Date.now() / 1000) {
                    cookieIssue('expired')
                    continue
                  }
                  if (row.originAttributes) {
                    cookieIssue('partitioned')
                    continue
                  }
                  let value = row.value
                  if (decryptor && row.encrypted_value?.length) {
                    try {
                      value = await decryptor.decrypt(row.encrypted_value, row.domain)
                    } catch (error) {
                      signal.throwIfAborted()
                      const reason = error instanceof CookieImportError ? error.reason : 'decryption_failed'
                      cookieIssue(reason, reason === 'decryption_failed')
                      continue
                    }
                  }
                  await applyCookie({
                    ...row,
                    value,
                    expires,
                    secure: !!row.secure,
                    httpOnly: !!row.httpOnly,
                    sameSite:
                      row.sameSite === 2
                        ? 'Strict'
                        : row.sameSite === 1
                          ? 'Lax'
                          : row.sameSite === 0
                            ? 'None'
                            : undefined
                  })
                }
              } finally {
                await decryptor?.dispose()
              }
            })
          } catch {
            signal.throwIfAborted()
            cookieIssue('source_unavailable', true)
          }
      }
    } else {
      if (!file) throw new Error('Select an import file')
      const handle = await open(file, 'r')
      let text: string
      try {
        if ((await handle.stat()).size > 20 * 1024 * 1024) throw new Error('Import file exceeds 20 MB')
        text = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
      const data = parsePortableBrowserData(text)
      if (options.history) result.history.unsupported = true
      if (options.localStorage) for (const origin of data.origins) await applyOrigin(origin)
      if (options.cookies) for (const cookie of data.cookies) await applyCookie(cookie)
    }
    signal.throwIfAborted()
  } catch (error) {
    if (!signal.aborted) throw error
    result.cancelled = true
  } finally {
    await target.cookies.flushStore()
    target.flushStorageData()
  }
  return result
}
