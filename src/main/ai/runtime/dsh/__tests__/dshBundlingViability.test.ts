import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'

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

  it('imports the built bridge plugin with production-declared runtime dependencies', async () => {
    const pluginPath = resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/plugin')
    await expect(import(pathToFileURL(pluginPath).href)).resolves.toMatchObject({ apply: expect.any(Function) })
  })

  it('loads the unified sharp stack through attachment-local and decodes a real PNG', async () => {
    const [{ prepareImageFile }, { default: sharp }] = await Promise.all([
      import(pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-attachment-local')).href),
      import('sharp')
    ])
    const png = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    })
      .png()
      .toBuffer()

    const prepared = await prepareImageFile(
      { data: png, mediaType: 'image/png' },
      {
        maxImageBytes: 1048576,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1048576,
        maxImagePixels: 1024,
        maxImageDimension: 32
      },
      { maxPixels: 1024, maxDimension: 32, maxBytes: 1048576 }
    )
    expect(prepared.ref).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
    expect(sharp.versions.sharp).toBe('0.35.3')
  })

  it('decodes a DSH attachment with WASM sharp in Electron-as-Node', async () => {
    const require = createRequire(import.meta.url)
    const electronBinary = require('electron')
    if (typeof electronBinary !== 'string') throw new Error('Electron binary is unavailable')

    const { default: sharp } = await import('sharp')
    const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#f00' } })
      .png()
      .toBuffer()
    const attachmentUrl = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-attachment-local')).href
    const output = execFileSync(
      electronBinary,
      [
        '--input-type=module',
        '-e',
        `import { createRequire } from 'node:module'
         import sharp from 'sharp'
         const require = createRequire(import.meta.url)
         if (!require.cache[require.resolve('@img/sharp-wasm32/sharp.node')]) {
           throw new Error('DSH did not load the WASM binding')
         }
         const { prepareImageFile } = await import(process.argv[1])
         const png = Buffer.from(process.argv[2], 'base64')
         const prepared = await prepareImageFile(
           { data: png, mediaType: 'image/png' },
           { maxImageBytes: 1048576, maxImagesPerMessage: 1, maxMessageImageBytes: 1048576,
             maxImagePixels: 1024, maxImageDimension: 32 },
           { maxPixels: 1024, maxDimension: 32, maxBytes: 1048576 }
         )
         const metadata = await sharp(png).metadata()
         process.stdout.write(JSON.stringify({ format: metadata.format, width: prepared.ref.width,
           height: prepared.ref.height }))`,
        attachmentUrl,
        png.toString('base64')
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHERRY_DSH_SHARP_WASM: '1' }, timeout: 15000 }
    )

    expect(JSON.parse(output.toString())).toEqual({ format: 'png', width: 2, height: 3 })
  }, 20000)
})
