import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
 * 3. pi's home/session dirs are forced to Cherry-owned paths via
 *    `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`; no `~/.pi/agent` access.
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

  it('imports the ESM-only SDK via dynamic import() and exposes the driver surface', async () => {
    const pi = await import('@earendil-works/pi-coding-agent')

    expect(typeof pi.createAgentSession).toBe('function')
    expect(typeof pi.DefaultResourceLoader).toBe('function')
    expect(typeof pi.AuthStorage).toBe('function')
    expect(typeof pi.ModelRegistry).toBe('function')
    expect(typeof pi.SessionManager).toBe('function')
    expect(typeof pi.SettingsManager).toBe('function')
    expect(typeof pi.ProjectTrustStore).toBe('function')
    expect(typeof pi.hasTrustRequiringProjectResources).toBe('function')
  })

  it('constructs the in-memory credential/model/session/settings objects (no network)', async () => {
    const { AuthStorage, ModelRegistry, SessionManager, SettingsManager, DefaultResourceLoader } = await import(
      '@earendil-works/pi-coding-agent'
    )

    const authStorage = AuthStorage.inMemory()
    // Cherry owns the key; it lands as a runtime override, never a persisted pi file.
    authStorage.setRuntimeApiKey('cherry-placeholder-provider', 'cherry-runtime-key')

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const sessionManager = SessionManager.inMemory(workspace)
    const settingsManager = SettingsManager.inMemory()
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir: piHome,
      settingsManager
    })

    expect(authStorage).toBeTruthy()
    expect(modelRegistry).toBeTruthy()
    expect(sessionManager).toBeTruthy()
    expect(loader).toBeTruthy()
  })

  it('honors Cherry-owned agent dir and never touches ~/.pi/agent', async () => {
    const { getAgentDir, hasTrustRequiringProjectResources } = await import('@earendil-works/pi-coding-agent')

    // The env override wins over pi's ~/.pi/agent default.
    expect(getAgentDir()).toBe(piHome)
    expect(getAgentDir().startsWith(homedir())).toBe(false)
    expect(existsSync(join(homedir(), '.pi', 'agent'))).toBe(false)

    // Trust probe on a plain workspace resolves locally with no network.
    const result = await hasTrustRequiringProjectResources(workspace)
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })
})
