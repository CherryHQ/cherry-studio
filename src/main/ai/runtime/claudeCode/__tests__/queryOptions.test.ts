import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const { createClaudeCodeQueryOptions, resolveClaudeConfigDirectory } = await import('../queryOptions')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('createClaudeCodeQueryOptions', () => {
  it('resolves the child config directory without falling back to a stale parent override', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/parent/custom')
    vi.spyOn(application, 'getPath').mockReturnValue('/registered/default')
    expect(resolveClaudeConfigDirectory()).toBe('/parent/custom')
    expect(resolveClaudeConfigDirectory({})).toBe('/registered/default')
    expect(resolveClaudeConfigDirectory({ CLAUDE_CONFIG_DIR: '/child/custom' })).toBe('/child/custom')
  })
  it.each([undefined, { sessionId: 'cherry-session' }])(
    'binds optional diagnostic identity outside SDK options: %j',
    (diagnosticContext) => {
      let captured: any
      vi.spyOn(application, 'get').mockReturnValue({
        spawn: (_options: unknown, diagnostics: unknown) => {
          captured = diagnostics
          return {}
        }
      } as never)
      const options = createClaudeCodeQueryOptions({ modelId: 'sonnet', settings: {}, diagnosticContext })
      options.spawnClaudeCodeProcess!({ command: 'claude', args: [], env: {}, signal: new AbortController().signal })
      expect(captured.sessionId).toBe(diagnosticContext?.sessionId ?? null)
      expect(options).not.toHaveProperty('diagnosticContext')
    }
  )

  it('strips Cherry-only runtime settings before passing options to the SDK', () => {
    const ignoredSpawn = vi.fn()
    const opts = createClaudeCodeQueryOptions({
      modelId: 'sonnet',
      settings: {
        resume: 'sdk-1',
        approvalEmitter: {},
        steerHolder: { pending: [], dispose: vi.fn() },
        warmQueryKey: 'session-1',
        toolPolicySnapshot: {},
        warmQueryInitializeTimeoutMs: 100,
        mcpToolMetadata: {},
        spawnClaudeCodeProcess: ignoredSpawn
      } as any
    })

    expect(opts).toMatchObject({ model: 'sonnet', resume: 'sdk-1' })
    expect(opts).not.toHaveProperty('approvalEmitter')
    expect(opts).not.toHaveProperty('steerHolder')
    expect(opts).not.toHaveProperty('warmQueryKey')
    expect(opts).not.toHaveProperty('toolPolicySnapshot')
    expect(opts).not.toHaveProperty('warmQueryInitializeTimeoutMs')
    expect(opts).not.toHaveProperty('mcpToolMetadata')
  })
})
