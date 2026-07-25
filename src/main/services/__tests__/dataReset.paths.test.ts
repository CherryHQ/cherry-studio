import path from 'node:path'

import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { describe, expect, it, vi } from 'vitest'

import { USER_DATA_KEPT, USER_DATA_WIPE } from '../dataReset'

// Keep the literal reset lists aligned with the real path registry.
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

const registry = buildPathRegistry()
const userData = registry['app.userdata']

function firstSegment(child: string, parent: string): string {
  return path.relative(parent, child).split(path.sep)[0]
}

function isWiped(entry: string): boolean {
  return USER_DATA_WIPE.includes(entry)
}

describe('dataReset ↔ pathRegistry conformance', () => {
  it('the sqlite family is the app.database.file basename plus its -wal/-shm sidecars', () => {
    const dbFile = path.basename(registry['app.database.file'])
    expect(isWiped(dbFile)).toBe(true)
    expect(isWiped(`${dbFile}-wal`)).toBe(true)
    expect(isWiped(`${dbFile}-shm`)).toBe(true)
    // Prefix matches could delete user-created backups.
    expect(isWiped(`${dbFile}-personal-backup`)).toBe(false)
    expect(isWiped(`${dbFile}.bak-20260101000000`)).toBe(false)
  })

  it('USER_DATA_WIPE names the registry-owned userData user state', () => {
    expect(USER_DATA_WIPE).toContain(firstSegment(registry['app.userdata.data'], userData))
    expect(USER_DATA_WIPE).toContain(path.basename(registry['feature.backup.restore.file']))
    expect(USER_DATA_WIPE).toContain(path.basename(registry['feature.backup.restore.staging']))
    expect(USER_DATA_WIPE).toContain(firstSegment(registry['feature.agents.claude.root'], userData))
    expect(USER_DATA_WIPE).toContain('cache.json')
    // Legacy restore sidecars are not registered paths.
    expect(USER_DATA_WIPE).toContain('Data.restore')
    expect(USER_DATA_WIPE).toContain('IndexedDB.restore')
    expect(USER_DATA_WIPE).toContain('Local Storage.restore')
  })

  it('USER_DATA_KEPT shields the model/toolchain trees the registry places under userData', () => {
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.embedding.models'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.ocr.paddleocr'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.onnxruntime.binary'], userData))
    expect(USER_DATA_KEPT).toContain(firstSegment(registry['feature.ocr.tesseract'], userData))
  })

  it('the data-reset marker survives its own wipe (a deliberate third category)', () => {
    // The marker is removed separately after the wipe is committed.
    const markerEntry = firstSegment(registry['feature.data_reset.marker_file'], userData)
    expect(markerEntry).toBe('data-reset.pending.json')
    expect(isWiped(markerEntry)).toBe(false)
    expect(USER_DATA_KEPT).not.toContain(markerEntry)
  })

  it('retains Data Reset sidecar residue as classified diagnostics', () => {
    for (const residue of ['data-reset.pending.invalid', 'data-reset.pending.json.tmp-123-abc']) {
      expect(isWiped(residue)).toBe(false)
      expect(USER_DATA_KEPT).not.toContain(residue)
    }
  })

  it('classifies every userData registry entry as wiped user state or a kept machine artifact', () => {
    // Every registered profile path must be classified.
    for (const [key, value] of Object.entries(registry)) {
      // process.resourcesPath ('app.extra_resources') is undefined outside Electron
      if (typeof value !== 'string') continue
      if (key === 'app.userdata' || !value.startsWith(userData + path.sep)) continue
      // The marker is managed separately.
      if (key === 'feature.data_reset.marker_file') continue
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
