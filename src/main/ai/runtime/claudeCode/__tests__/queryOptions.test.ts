import { describe, expect, it, vi } from 'vitest'

const { createClaudeCodeQueryOptions } = await import('../queryOptions')

describe('createClaudeCodeQueryOptions', () => {
  it('strips Cherry-only runtime settings before passing options to the SDK', () => {
    const opts = createClaudeCodeQueryOptions({
      modelId: 'sonnet',
      settings: {
        resume: 'sdk-1',
        approvalEmitter: {},
        steerHolder: { pending: [], dispose: vi.fn() },
        warmQueryKey: 'session-1',
        toolPolicySnapshot: {},
        warmQueryInitializeTimeoutMs: 100,
        mcpToolMetadata: {}
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
