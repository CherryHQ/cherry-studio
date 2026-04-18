import { describe, expect, it } from 'vitest'

import { shouldAutoEnsure } from '../pathRegistry'

// Pure data-rule tests for `shouldAutoEnsure`. Decoupled from
// Application.getPath so that a regression in the auto-ensure rules can be
// localized to the rule table without rerunning the integration test
// suite, and so a single source of truth for the NO_ENSURE list lives in
// `pathRegistry.ts` (and is exercised here).
//
// We do NOT mock buildPathRegistry. The function being tested is a pure
// rule on a string-keyed namespace; it does not call Electron APIs. The
// global `electron` mock from `tests/main.setup.ts` covers the lone
// `import { app } from 'electron'` at the top of the registry module.

describe('pathRegistry.shouldAutoEnsure', () => {
  describe('cherry-owned directories — should auto-ensure', () => {
    it('returns true for cherry.bin', () => {
      expect(shouldAutoEnsure('cherry.bin')).toBe(true)
    })

    it('returns true for cherry.config', () => {
      expect(shouldAutoEnsure('cherry.config')).toBe(true)
    })

    it('returns true for cherry.home', () => {
      expect(shouldAutoEnsure('cherry.home')).toBe(true)
    })

    it('returns true for app.userdata (cherry-owned, no opt-out)', () => {
      expect(shouldAutoEnsure('app.userdata')).toBe(true)
    })

    it('returns true for the cherry-owned sub-key app.userdata.data', () => {
      expect(shouldAutoEnsure('app.userdata.data')).toBe(true)
    })

    it('returns true for the new app.session.cache key', () => {
      expect(shouldAutoEnsure('app.session.cache')).toBe(true)
    })

    it('returns true for feature.notes.data', () => {
      expect(shouldAutoEnsure('feature.notes.data')).toBe(true)
    })

    it('returns true for feature.files.data', () => {
      expect(shouldAutoEnsure('feature.files.data')).toBe(true)
    })

    it('returns true for feature.mcp', () => {
      expect(shouldAutoEnsure('feature.mcp')).toBe(true)
    })

    it('returns true for the new feature.agents.workspaces key', () => {
      // Registered for BaseService's per-agent workspace parent dir
      // (`userData/Data/Agents`). Cherry-owned, writable, not opted out.
      expect(shouldAutoEnsure('feature.agents.workspaces')).toBe(true)
    })

    it('returns true for feature.agents.skills (now that its value is fixed)', () => {
      // Value was corrected from CHERRY_HOME/skills (the old orphan value)
      // to appUserDataData/Skills. The shouldAutoEnsure rule itself is
      // unchanged — it's not in NO_ENSURE — but exercising it here makes
      // the rename visible in the test suite.
      expect(shouldAutoEnsure('feature.agents.skills')).toBe(true)
    })
  })

  describe('cherry-owned files — should auto-ensure (Application.getPath ensures the dirname)', () => {
    // shouldAutoEnsure does not branch on file vs directory — that
    // distinction is handled at the Application.getPath layer via
    // `key.endsWith('file')`. The data rule simply says "this key is
    // not opted out". So the assertion below holds for both directory
    // and file keys that are not in NO_ENSURE.

    it('returns true for the new feature.version_log.file key', () => {
      expect(shouldAutoEnsure('feature.version_log.file')).toBe(true)
    })

    it('returns true for app.database.file', () => {
      expect(shouldAutoEnsure('app.database.file')).toBe(true)
    })

    it('returns true for the new feature.copilot.token_file key', () => {
      expect(shouldAutoEnsure('feature.copilot.token_file')).toBe(true)
    })

    it('returns true for the new feature.anthropic.oauth_file key', () => {
      expect(shouldAutoEnsure('feature.anthropic.oauth_file')).toBe(true)
    })

    it('returns true for the new feature.mcp.memory_file key', () => {
      expect(shouldAutoEnsure('feature.mcp.memory_file')).toBe(true)
    })
  })

  describe('sys.* prefix — never auto-ensure (OS-managed directories)', () => {
    it('returns false for sys.home', () => {
      expect(shouldAutoEnsure('sys.home')).toBe(false)
    })

    it('returns false for sys.downloads (covered by sys. prefix, not an exact entry)', () => {
      expect(shouldAutoEnsure('sys.downloads')).toBe(false)
    })

    it('returns false for sys.documents', () => {
      expect(shouldAutoEnsure('sys.documents')).toBe(false)
    })

    it('returns false for sys.appdata', () => {
      expect(shouldAutoEnsure('sys.appdata')).toBe(false)
    })

    it('returns false for sys.appdata.autostart (multi-segment under the sys. prefix)', () => {
      // Verifies the prefix match works on deeper nesting too — a key
      // like 'sys.appdata.autostart' must match the 'sys.' entry, not
      // require its own exact entry.
      expect(shouldAutoEnsure('sys.appdata.autostart')).toBe(false)
    })
  })

  describe('external.* prefix — never auto-ensure (third-party tool dirs)', () => {
    it('returns false for external.openclaw.config', () => {
      expect(shouldAutoEnsure('external.openclaw.config')).toBe(false)
    })

    it('returns false for the new external.obsidian.config_file key', () => {
      // Obsidian's config file lives in a directory that Cherry must
      // never create — Obsidian itself owns it. This is the canonical
      // case for the external.* prefix opt-out.
      expect(shouldAutoEnsure('external.obsidian.config_file')).toBe(false)
    })
  })

  describe('NO_ENSURE exact keys — read-only build artifacts', () => {
    it('returns false for app.exe_file', () => {
      expect(shouldAutoEnsure('app.exe_file')).toBe(false)
    })

    it('returns false for app.root', () => {
      expect(shouldAutoEnsure('app.root')).toBe(false)
    })

    it('returns false for app.install', () => {
      expect(shouldAutoEnsure('app.install')).toBe(false)
    })

    it('returns false for app.extra_resources (electron-builder extraResources root)', () => {
      expect(shouldAutoEnsure('app.extra_resources')).toBe(false)
    })

    it('returns false for app.root.resources (bundled asar-internal resources root)', () => {
      expect(shouldAutoEnsure('app.root.resources')).toBe(false)
    })

    it('returns false for app.root.resources.scripts', () => {
      expect(shouldAutoEnsure('app.root.resources.scripts')).toBe(false)
    })

    it('returns false for app.root.resources.binaries', () => {
      expect(shouldAutoEnsure('app.root.resources.binaries')).toBe(false)
    })

    it('returns false for app.database.migrations (packaged read-only path)', () => {
      expect(shouldAutoEnsure('app.database.migrations')).toBe(false)
    })
  })

  describe('app.* keys NOT in NO_ENSURE — should auto-ensure', () => {
    // Sanity check that the exact-key opt-outs are not over-broad: any
    // app.* key that is not specifically listed must still auto-ensure.
    // Catches accidental over-matching of the NO_ENSURE table.

    it('returns true for app.logs (Electron logs dir, Cherry-owned)', () => {
      expect(shouldAutoEnsure('app.logs')).toBe(true)
    })

    it('returns true for app.crash_dumps', () => {
      expect(shouldAutoEnsure('app.crash_dumps')).toBe(true)
    })

    it('returns true for app.session', () => {
      expect(shouldAutoEnsure('app.session')).toBe(true)
    })

    it('returns true for app.temp', () => {
      expect(shouldAutoEnsure('app.temp')).toBe(true)
    })
  })
})
