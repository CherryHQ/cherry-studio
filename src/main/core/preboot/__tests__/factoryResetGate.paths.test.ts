import path from 'node:path'

import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { describe, expect, it, vi } from 'vitest'

import { USER_DATA_KEPT, USER_DATA_WIPE, USER_DATA_WIPE_PREFIXES } from '../factoryResetGate'

// Conformance test: factoryResetGate's wipe list is literal entry names,
// while the paths they refer to are owned by pathRegistry. This suite pins
// each literal to the registry key it mirrors, so relocating or renaming a
// path in the registry fails here instead of silently un-covering (or
// mis-covering) it in the wipe. It intentionally builds the REAL registry —
// no buildPathRegistry mock — because the whole point is to observe the
// registry's actual values.

// The global electron mock (tests/main.setup.ts) lacks getAppPath/isPackaged,
// which buildPathRegistry needs; override locally with the same getPath values.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      switch (key) {
        case 'userData':
          return '/mock/userData'
        case 'temp':
          return '/mock/temp'
        case 'logs':
          return '/mock/logs'
        default:
          return '/mock/unknown'
      }
    }),
    getAppPath: vi.fn(() => '/mock/app'),
    isPackaged: false
  },
  dialog: { showErrorBox: vi.fn() }
}))

// Importing the gate for its constants must not construct the real
// BootConfigService (module-load fs reads).
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: {} }))

const registry = buildPathRegistry()
const userData = registry['app.userdata']

/** First path segment of `child` relative to `parent` — a directory-entry name. */
function firstSegment(child: string, parent: string): string {
  return path.relative(parent, child).split(path.sep)[0]
}

/** Same membership rule the gate applies to a directory entry. */
function isWiped(entry: string): boolean {
  return USER_DATA_WIPE.includes(entry) || USER_DATA_WIPE_PREFIXES.some((prefix) => entry.startsWith(prefix))
}

describe('factoryResetGate ↔ pathRegistry conformance', () => {
  it('the sqlite prefix family is rooted at the app.database.file basename', () => {
    const dbFile = path.basename(registry['app.database.file'])
    expect(USER_DATA_WIPE_PREFIXES).toContain(dbFile)
    // The prefix covers the sidecars an exact-name list would miss.
    expect(isWiped(`${dbFile}-wal`)).toBe(true)
    expect(isWiped(`${dbFile}-shm`)).toBe(true)
    expect(isWiped(`${dbFile}.bak-20260101000000`)).toBe(true)
  })

  it('USER_DATA_WIPE names the registry-owned userData user state', () => {
    expect(USER_DATA_WIPE).toContain(firstSegment(registry['app.userdata.data'], userData))
    expect(USER_DATA_WIPE).toContain(path.basename(registry['feature.version_log.file']))
    expect(USER_DATA_WIPE).toContain(path.basename(registry['feature.backup.restore.file']))
    expect(USER_DATA_WIPE).toContain(path.basename(registry['feature.backup.restore.staging']))
    expect(USER_DATA_WIPE).toContain(firstSegment(registry['feature.agents.claude.root'], userData))
    // 'cache.json' has no registry key — CacheService names it inline against
    // 'app.userdata' (see the reverse comment at its persistFilePath).
    expect(USER_DATA_WIPE).toContain('cache.json')
    // 'Data.restore' has no registry key yet — LegacyBackupManager names it
    // inline against the userData root as `${Data}.restore`.
    expect(USER_DATA_WIPE).toContain('Data.restore')
  })

  it('USER_DATA_KEPT shields the model/toolchain trees the registry places under userData', () => {
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.embedding.models'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.ocr.paddleocr'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.onnxruntime.binary'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.ocr.tesseract'], userData))
  })

  it('classifies every userData registry entry as wiped user state or a kept machine artifact', () => {
    // A NEW registry key under userData must be classified deliberately:
    // user state → add its entry name to USER_DATA_WIPE in factoryResetGate;
    // re-downloadable machine artifact → add it to USER_DATA_KEPT.
    for (const [key, value] of Object.entries(registry)) {
      // process.resourcesPath ('app.extra_resources') is undefined outside Electron
      if (typeof value !== 'string') continue
      if (key === 'app.userdata' || !value.startsWith(userData + path.sep)) continue
      const entry = firstSegment(value, userData)
      expect(
        isWiped(entry) || USER_DATA_KEPT.includes(entry),
        `unclassified userData entry '${entry}' from registry key '${key}'`
      ).toBe(true)
    }
  })

  it('no entry is both wiped and kept', () => {
    for (const entry of USER_DATA_KEPT) {
      expect(isWiped(entry), `'${entry}' is in USER_DATA_KEPT but matches the wipe list`).toBe(false)
    }
  })
})
