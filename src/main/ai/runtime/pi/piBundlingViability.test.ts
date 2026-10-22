import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Phase 0 bundling spike (GO/NO-GO gate).
 *
 * Proves the in-process SDK path is viable without a provider key or network:
 * 1. `@earendil-works/pi-coding-agent` (ESM-only, `type: module`) is importable
 *    from Cherry's main process via dynamic `import()`. Static `import`/`require()`
 *    is NOT viable — pi's `exports` map defines only the `import`/`types`
 *    conditions, so a CJS `require()` (which is how electron-vite externalizes a
 *    static import in the CJS main bundle) throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *    The consuming driver MUST use dynamic `import()`; the CJS bundle preserves it
 *    as a native dynamic import that honors the `import` condition.
 * 2. The SDK's in-memory objects construct with no filesystem/network dependency.
 * 3. pi's home/session dirs are forced to isolated Cherry-owned paths via
 *    `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`.
 */
describe('pi SDK bundling viability (Phase 0 spike)', () => {
  let piHome: string
  let piSessions: string
  let workspace: string
  const savedHome = process.env.PI_CODING_AGENT_DIR
  const savedSessions = process.env.PI_CODING_AGENT_SESSION_DIR

  beforeAll(() => {
    piHome = mkdtempSync(join(tmpdir(), 'cherry-pi-home-'))
    piSessions = mkdtempSync(join(tmpdir(), 'cherry-pi-sessions-'))
    workspace = mkdtempSync(join(tmpdir(), 'cherry-pi-workspace-'))
    process.env.PI_CODING_AGENT_DIR = piHome
    process.env.PI_CODING_AGENT_SESSION_DIR = piSessions
  })

  afterAll(() => {
    if (savedHome === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedHome
    if (savedSessions === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = savedSessions
  })

  it('isolates runtime credentials between sessions without writing Pi auth or model files', async () => {
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const otherRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const provider = { baseUrl: 'https://example.invalid/v1', api: 'openai-completions' as const }
    runtime.registerProvider('cherry-test', provider)
    otherRuntime.registerProvider('cherry-test', provider)
    await runtime.setRuntimeApiKey('cherry-test', 'synthetic-test-key')

    expect(await runtime.getAuth('cherry-test')).toMatchObject({ auth: { apiKey: 'synthetic-test-key' } })
    expect(await otherRuntime.getAuth('cherry-test')).not.toMatchObject({ auth: { apiKey: 'synthetic-test-key' } })
    expect(existsSync(join(piHome, 'auth.json'))).toBe(false)
    expect(existsSync(join(piHome, 'models.json'))).toBe(false)
  })

  it('honors the isolated Cherry-owned agent dir', async () => {
    const { getAgentDir, hasTrustRequiringProjectResources } = await import('@earendil-works/pi-coding-agent')

    // The env override wins over pi's ~/.pi/agent default.
    expect(getAgentDir()).toBe(piHome)

    // Trust probe on a plain workspace resolves locally with no network.
    const result = hasTrustRequiringProjectResources(workspace)
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })
})
