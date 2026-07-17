import path from 'node:path'

import { CHERRY_HOME } from '@main/core/paths/constants'
import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { describe, expect, it, vi } from 'vitest'

import {
  CHERRY_HOME_WIPE,
  OWNED_MANIFEST_EXTRAS,
  OWNERSHIP_SENTINEL,
  USER_DATA_KEEP,
  USER_DATA_MANIFEST
} from '../factoryResetGate'

// Conformance test: factoryResetGate's wipe lists are literal entry names,
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

describe('factoryResetGate ↔ pathRegistry conformance', () => {
  it('OWNERSHIP_SENTINEL is the basename of app.database.file', () => {
    expect(OWNERSHIP_SENTINEL).toBe(path.basename(registry['app.database.file']))
  })

  it('USER_DATA_MANIFEST covers every registry-owned userData artifact', () => {
    const dbFile = path.basename(registry['app.database.file'])
    expect(USER_DATA_MANIFEST).toContain(dbFile)
    expect(USER_DATA_MANIFEST).toContain(`${dbFile}-wal`)
    expect(USER_DATA_MANIFEST).toContain(`${dbFile}-shm`)
    expect(USER_DATA_MANIFEST).toContain(firstSegment(registry['app.userdata.data'], userData))
    expect(USER_DATA_MANIFEST).toContain(path.basename(registry['feature.backup.restore.file']))
    expect(USER_DATA_MANIFEST).toContain(path.basename(registry['feature.backup.restore.staging']))
    // 'cache.json' has no registry key — CacheService names it inline against
    // 'app.userdata' (see the reverse comment at its persistFilePath).
    expect(USER_DATA_MANIFEST).toContain('cache.json')
  })

  it('USER_DATA_KEEP shields the model/toolchain trees the registry places under userData', () => {
    expect(USER_DATA_KEEP).toContain(firstSegment(registry['feature.embedding.models'], userData))
    expect(USER_DATA_KEEP).toContain(firstSegment(registry['feature.ocr.paddleocr'], userData))
    expect(USER_DATA_KEEP).toContain(firstSegment(registry['feature.onnxruntime.binary'], userData))
  })

  it('OWNED_MANIFEST_EXTRAS names the registry-owned userData-root user state', () => {
    expect(OWNED_MANIFEST_EXTRAS).toContain(path.basename(registry['feature.version_log.file']))
    expect(OWNED_MANIFEST_EXTRAS).toContain(firstSegment(registry['feature.agents.claude.root'], userData))
    expect(OWNED_MANIFEST_EXTRAS).toContain(firstSegment(registry['feature.ocr.tesseract'], userData))
  })

  it('CHERRY_HOME_WIPE matches the registry keys it targets', () => {
    expect(CHERRY_HOME_WIPE).toContain(firstSegment(registry['cherry.config'], CHERRY_HOME))
    expect(CHERRY_HOME_WIPE).toContain(firstSegment(registry['feature.mcp'], CHERRY_HOME))
    expect(CHERRY_HOME_WIPE).toContain(firstSegment(registry['feature.trace'], CHERRY_HOME))
  })

  it('classifies every CHERRY_HOME registry entry as wiped user state or a kept machine artifact', () => {
    // The machine artifacts a factory reset keeps (#17131) — mirrors the
    // CHERRY_HOME_WIPE doc comment. A NEW registry key under CHERRY_HOME must
    // be classified deliberately: user state → add its first segment to
    // CHERRY_HOME_WIPE in factoryResetGate; re-downloadable machine artifact
    // → add it here.
    const KEPT_MACHINE_ARTIFACTS = ['bin', 'binary-manager', 'ovms', 'install']
    const classified = new Set([...CHERRY_HOME_WIPE, ...KEPT_MACHINE_ARTIFACTS])

    for (const [key, value] of Object.entries(registry)) {
      // process.resourcesPath ('app.extra_resources') is undefined outside Electron
      if (typeof value !== 'string') continue
      if (key === 'cherry.home' || !value.startsWith(CHERRY_HOME + path.sep)) continue
      const entry = firstSegment(value, CHERRY_HOME)
      expect(classified, `unclassified CHERRY_HOME entry '${entry}' from registry key '${key}'`).toContain(entry)
    }
  })

  it('the OVMS model registry key sits inside the kept feature.ovms.ovms tree', () => {
    expect(registry['feature.ovms.model_registry_file']).toBe(
      path.join(registry['feature.ovms.ovms'], 'models', 'config.json')
    )
  })
})
