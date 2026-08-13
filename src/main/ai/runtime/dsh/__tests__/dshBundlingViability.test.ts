import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Bundling viability gate (mirrors pi's Phase 0 spike test).
 *
 * `@deepseek-ai/dsh-sdk-client` is ESM-only, so the driver MUST reach it via
 * dynamic `import()` (see `dshSdk.ts`); a static import would be emitted as a
 * CJS `require()` of an ESM entry in the main bundle and fail at runtime. The
 * composition builder additionally depends on `require.resolve` finding the
 * runtime bin and every composed plugin on disk.
 */
describe('dsh SDK bundling viability', () => {
  it('imports the ESM-only client SDK via dynamic import() and exposes the driver surface', async () => {
    const sdk = await import('@deepseek-ai/dsh-sdk-client')

    expect(typeof sdk.HarnessClient).toBe('function')
    expect(typeof sdk.DeepSeekHarness).toBe('function')
    expect(typeof sdk.TransportClosedError).toBe('function')
  })

  it('resolves the runtime bin and every composed plugin to on-disk entries', () => {
    const require_ = createRequire(import.meta.url)
    const specifiers = [
      '@deepseek-ai/dsh-sdk-jsonrpc-demo/bin',
      '@deepseek-ai/dsh-sdk-jsonrpc-server',
      '@deepseek-ai/dsh-llm-pi-ai',
      '@deepseek-ai/dsh-llm-retry',
      '@deepseek-ai/dsh-sandbox-local',
      '@deepseek-ai/dsh-sandbox-policy',
      '@deepseek-ai/dsh-subprocess-local',
      '@deepseek-ai/dsh-bash-sandbox',
      '@deepseek-ai/dsh-user-approval',
      '@deepseek-ai/dsh-agent-spine-demo',
      '@deepseek-ai/dsh-attachment-local',
      '@deepseek-ai/dsh-fs-local',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-todo',
      '@deepseek-ai/dsh-compaction-tool-result-pruner',
      '@deepseek-ai/dsh-compaction-basic',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-command-compact',
      '@deepseek-ai/dsh-command-goal',
      '@deepseek-ai/dsh-goal',
      '@deepseek-ai/dsh-tool-goal',
      '@deepseek-ai/dsh-session-persistence-jsonl',
      '@cherrystudio/dsh-bridge/plugin'
    ]
    for (const specifier of specifiers) {
      const resolved = require_.resolve(specifier)
      expect(path.isAbsolute(resolved), `not absolute: ${resolved}`).toBe(true)
      expect(existsSync(resolved), `missing on disk: ${resolved}`).toBe(true)
    }
  })

  it('loads the unified sharp stack through attachment-local and decodes a real PNG', async () => {
    const [{ detectImage }, { default: sharp }] = await Promise.all([
      import('@deepseek-ai/dsh-attachment-local'),
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
