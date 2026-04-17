import fs from 'node:fs'

// Type-only import used to give vi.importActual a generic argument that
// satisfies @typescript-eslint/consistent-type-imports (which forbids
// inline `import()` type annotations).
import type * as PathRegistryModule from '@main/core/paths/pathRegistry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

// Mock @main/core/paths/pathRegistry (the deep path used by Application.ts)
// instead of the public @main/core/paths re-export. The public entry only
// re-exports types — Application.ts imports the buildPathRegistry function
// (and the shouldAutoEnsure helper) from the deep path, so that's where
// the mock has to live.
//
// We use `importActual + spread` to keep the real `shouldAutoEnsure`
// implementation (and its `NoEnsureEntry` template-literal type machinery)
// intact while overriding only `buildPathRegistry`. Fully mocking the
// module would mean Application.getPath() calls a missing
// `shouldAutoEnsure` and crashes, defeating the test.
//
// The mocked pathMap covers every key the lazy-auto-ensure tests touch.
// All paths use forward slashes — the global node:path mock joins with
// '/' (see tests/main.setup.ts:185), and node:path.dirname is left at
// the actual implementation, which handles forward slashes on every
// platform.
vi.mock('@main/core/paths/pathRegistry', async () => {
  const actual = await vi.importActual<typeof PathRegistryModule>('@main/core/paths/pathRegistry')
  return {
    ...actual,
    buildPathRegistry: () =>
      Object.freeze({
        // Cherry-owned directories (eligible for auto-ensure)
        'feature.files.data': '/mock/userData/Data/Files',
        'feature.notes.data': '/mock/userData/Data/Notes',
        'cherry.bin': '/mock/home/.cherrystudio/bin',
        // Cherry-owned files (auto-ensure dirname only)
        'feature.copilot.token_file': '/mock/home/.cherrystudio/config/.copilot_token',
        'app.database.file': '/mock/userData/cherrystudio.sqlite',
        // NO_ENSURE — exact key entries (build artifacts)
        'app.exe_file': '/mock/install/CherryStudio',
        'app.extra_resources': '/mock/resources',
        // NO_ENSURE — namespace prefixes
        'external.openclaw.config': '/mock/home/.openclaw',
        'sys.home': '/mock/home'
      })
  }
})

import { Application } from '@main/core/application/Application'
import { buildPathRegistry } from '@main/core/paths/pathRegistry'

// Bypass the global mock of '@application' (which exports a stub
// `application` proxy with a no-op bootstrap) by importing the real
// Application class directly via its file path. The global mock only
// intercepts the directory/index path, leaving `Application.ts` reachable
// via the `@main/*` alias.

describe('Application.getPath', () => {
  const app = Application.getInstance()

  beforeEach(() => {
    // Reset the global fs.mkdirSync call counter and re-inject a fresh
    // pathMap. __setPathMapForTesting clears the ensuredKeys cache too,
    // so every test starts from "no key has been ensured yet".
    vi.mocked(fs.mkdirSync).mockClear()
    app.__setPathMapForTesting(buildPathRegistry())
  })

  describe('basic lookup', () => {
    it('returns the registered path when no filename is given', () => {
      expect(app.getPath('feature.files.data')).toBe('/mock/userData/Data/Files')
    })

    it('joins a single-segment filename to the registered path', () => {
      // node:path.join is mocked in main.setup.ts to use '/' separator
      expect(app.getPath('feature.files.data', 'valid.txt')).toBe('/mock/userData/Data/Files/valid.txt')
    })
  })

  describe('filename validation — graceful degradation', () => {
    // The validation logs a warning via loggerService but does NOT throw.
    // This lets gradual migration continue when callers temporarily use
    // multi-segment filenames; the warning is a developer-facing hint.

    it('does not throw when filename is absolute', () => {
      expect(() => app.getPath('feature.files.data', '/abs/path')).not.toThrow()
    })

    it('does not throw when filename contains ".."', () => {
      expect(() => app.getPath('feature.files.data', '../escape')).not.toThrow()
    })

    it('does not throw when filename contains a path separator', () => {
      expect(() => app.getPath('feature.files.data', 'sub/file.txt')).not.toThrow()
    })

    it('returns a non-empty string even for suspicious filenames', () => {
      const result = app.getPath('feature.files.data', '../escape')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('pre-bootstrap throw guard', () => {
    it('throws a clear error when pathMap is null (pre-initPathRegistry)', () => {
      // Temporarily reset pathMap to simulate the pre-initPathRegistry state.
      app.__setPathMapForTesting(null)
      expect(() => app.getPath('feature.files.data')).toThrowError(
        /called before application\.initPathRegistry\(\) ran/
      )
      // Restore the mock for any subsequent test that runs in the same
      // describe (the beforeEach also restores it, but we want this case
      // to leave the state clean for any in-flight observation).
      app.__setPathMapForTesting(buildPathRegistry())
    })
  })

  describe('lazy auto-ensure', () => {
    it('mkdirs the base directory on first access of a directory key', () => {
      app.getPath('feature.notes.data')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/userData/Data/Notes', { recursive: true })
    })

    it('does not mkdir on the second access of the same key (cache hit)', () => {
      app.getPath('feature.notes.data')
      app.getPath('feature.notes.data')
      // Cached after the first call — second call must skip mkdir entirely.
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
    })

    it('mkdirs path.dirname(base) for a key whose name ends with "_file"', () => {
      app.getPath('feature.copilot.token_file')
      // The token file key points to a file; auto-ensure should target
      // its parent directory so the caller can immediately write the file.
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.cherrystudio/config', { recursive: true })
    })

    it('mkdirs path.dirname(base) for a key whose name ends with ".file"', () => {
      app.getPath('app.database.file')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/userData', { recursive: true })
    })

    it('does not mkdir for keys in the NO_ENSURE exact list (app.exe_file)', () => {
      app.getPath('app.exe_file')
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('does not mkdir for keys in the NO_ENSURE exact list (app.extra_resources)', () => {
      app.getPath('app.extra_resources')
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('does not mkdir for keys under the external.* prefix', () => {
      app.getPath('external.openclaw.config')
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('does not mkdir for keys under the sys.* prefix', () => {
      app.getPath('sys.home')
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('mkdirs cherry-owned keys not in the NO_ENSURE list', () => {
      app.getPath('cherry.bin')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.cherrystudio/bin', { recursive: true })
    })

    it('returns the path even when mkdir throws, and caches the failed attempt', () => {
      const err = new Error('EACCES: read-only filesystem')
      vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
        throw err
      })

      const result1 = app.getPath('feature.files.data')
      expect(result1).toBe('/mock/userData/Data/Files')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)

      // Failure is cached the same as success — no retry on the next call.
      // This prevents a retry-storm if the FS is unhealthy.
      const result2 = app.getPath('feature.files.data')
      expect(result2).toBe('/mock/userData/Data/Files')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
    })

    it('does not run mkdir twice when filename is supplied', () => {
      app.getPath('feature.files.data', 'avatar.png')
      // The filename argument is purely a join — it must NOT change which
      // directory gets ensured (always the registered base, not base/file).
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/userData/Data/Files', { recursive: true })
    })

    it('isolates the cache per key (two distinct keys each get their own mkdir)', () => {
      app.getPath('feature.notes.data')
      app.getPath('feature.files.data')
      // Two distinct keys → two distinct mkdir calls; the cache for one
      // must not suppress the other.
      expect(fs.mkdirSync).toHaveBeenCalledTimes(2)
      expect(fs.mkdirSync).toHaveBeenNthCalledWith(1, '/mock/userData/Data/Notes', { recursive: true })
      expect(fs.mkdirSync).toHaveBeenNthCalledWith(2, '/mock/userData/Data/Files', { recursive: true })
    })

    it('clears the auto-ensure cache when __setPathMapForTesting is called', () => {
      app.getPath('feature.notes.data')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)

      // Re-injecting the path map should also clear the ensuredKeys cache,
      // so the next call mkdirs the same key again.
      app.__setPathMapForTesting(buildPathRegistry())
      vi.mocked(fs.mkdirSync).mockClear()

      app.getPath('feature.notes.data')
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1)
    })
  })

  // Note: compile-time PathKey enforcement is verified via `pnpm typecheck`
  // (which runs tsgo). vitest's compile path uses esbuild and does not
  // enforce type-only directives like @ts-expect-error reliably, so we do
  // not assert them here.
})
