import { describe, expect, it, vi } from 'vitest'

const { spawnClaudeCodeProcess } = await import('../ClaudeCodeProcessManager')
const { createClaudeCodeQueryOptions } = await import('../queryOptions')

describe('createClaudeCodeQueryOptions', () => {
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
        runtimeContext: { template: 'Current time: {{time}}', modelName: 'Claude Sonnet' },
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
    expect(opts).not.toHaveProperty('runtimeContext')
    expect(opts.spawnClaudeCodeProcess).toBe(spawnClaudeCodeProcess)
  })
})
