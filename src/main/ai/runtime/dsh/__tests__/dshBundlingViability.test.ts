import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { listBundledDshRuntimeEntries, resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'
import { describe, expect, it } from 'vitest'

import { loadDshSdk, loadDshSdkProtocol } from '../dshSdk'

/**
 * Bundling viability gate (mirrors pi's Phase 0 spike test).
 *
 * `@deepseek-ai/dsh-sdk-client` is ESM-only, so the driver MUST reach it via
 * dynamic `import()` (see `dshSdk.ts`); a static import would be emitted as a
 * CJS `require()` of an ESM entry in the main bundle and fail at runtime. The
 * composition builder additionally needs every generated runtime entry on disk.
 */
describe('dsh SDK bundling viability', () => {
  it('loads the ESM-only client SDK through the runtime entry point', async () => {
    const sdk = await loadDshSdk()

    expect(typeof sdk.HarnessClient).toBe('function')
  })

  it('loads the ESM-only bridge transport class through the runtime entry point', async () => {
    const protocol = await loadDshSdkProtocol()

    expect(typeof protocol.JsonRpcLineTransport).toBe('function')
  })

  it('resolves the runtime bin and every composed plugin to on-disk entries', () => {
    const specifiers = listBundledDshRuntimeEntries()
    for (const specifier of specifiers) {
      const resolved = resolveBundledDshRuntimeEntry(specifier)
      expect(path.isAbsolute(resolved), `not absolute: ${resolved}`).toBe(true)
      expect(existsSync(resolved), `missing on disk: ${resolved}`).toBe(true)
    }
  })

  it('imports the built bridge plugin with production-declared runtime dependencies', async () => {
    const pluginPath = resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/plugin')
    await expect(import(pathToFileURL(pluginPath).href)).resolves.toMatchObject({ apply: expect.any(Function) })
  })

  it('loads the unified sharp stack through attachment-local and decodes a real PNG', async () => {
    const [{ detectImage }, { default: sharp }] = await Promise.all([
      import(pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-attachment-local')).href),
      import('sharp')
    ])
    const png = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    })
      .png()
      .toBuffer()

    await expect(detectImage(png)).resolves.toEqual({ mediaType: 'image/png', width: 1, height: 1 })
    expect(sharp.versions.sharp).toBe('0.35.3')
  })
})
