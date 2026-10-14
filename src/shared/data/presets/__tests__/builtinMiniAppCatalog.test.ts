import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { BUILTIN_MINI_APPS } from '@shared/data/presets/miniApps'
import { MiniAppManifestSchema } from '@shared/types/miniAppManifest'

// Anchored on this file, not `process.cwd()`: the gate must hold wherever vitest is invoked from.
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', 'resources', 'builtin-mini-apps')

describe('builtin mini app catalog', () => {
  it.each(BUILTIN_MINI_APPS)('$appId matches its shipped package', (entry) => {
    // Display-only, but a catalog disagreeing with its package shows one name in the
    // launcher and another once installed. Make that drift a build failure.
    const manifest = MiniAppManifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(ROOT, entry.appId, 'manifest.json'), 'utf8'))
    )
    expect(manifest.id).toBe(entry.appId)
    expect(manifest.name).toEqual(entry.name)
    expect(manifest.icon?.path).toBe(entry.icon)
    // The runtime validator refuses a missing entry at install — CI is the cheaper
    // place to learn a shipped tree cannot install.
    expect(fs.statSync(path.join(ROOT, entry.appId, manifest.entry)).isFile()).toBe(true)
    // The digest the installer verifies (`assertIconMatchesDigest`): a mistyped sha256
    // passing CI would instead fail every user's FIRST install of the app.
    if (manifest.icon) {
      const bytes = fs.readFileSync(path.join(ROOT, entry.appId, manifest.icon.path))
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(manifest.icon.sha256)
    }
  })

  it.each(BUILTIN_MINI_APPS)('$appId ships a pre-normalized icon', async (entry) => {
    // A builtin app shown BEFORE installation has no `logoSrc`, so the launcher reads
    // `resources/` directly — the 128x128 WebP normalization must happen at build time.
    const sharp = (await import('sharp')).default
    const meta = await sharp(path.join(ROOT, entry.appId, entry.icon)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 128, 128])
  })

  it('has an entry for every shipped directory', () => {
    // The other direction: a package dropped into resources without a catalog entry
    // ships dead weight into every installer and never appears in the launcher.
    const dirs = fs.existsSync(ROOT)
      ? fs
          .readdirSync(ROOT, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : []
    expect(dirs.sort()).toEqual(BUILTIN_MINI_APPS.map((e) => e.appId).sort())
  })
})
