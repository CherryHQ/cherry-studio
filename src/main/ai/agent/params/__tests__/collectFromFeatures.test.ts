import { describe, expect, it, vi } from 'vitest'

import { collectFromFeatures } from '../collectFromFeatures'
import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

function makeScope(): RequestScope {
  return {
    request: { mcpToolIds: [] } as never,
    signal: new AbortController().signal,
    registry: {} as never,
    assistant: undefined,
    model: { id: 'm1' } as never,
    provider: { id: 'p1' } as never,
    capabilities: undefined,
    sdkConfig: { providerId: 'p1' as never, providerSettings: {} as never, modelId: 'm1' },
    requestContext: { requestId: 'req-1', abortSignal: new AbortController().signal },
    mcpToolIds: new Set()
  }
}

describe('collectFromFeatures', () => {
  it('runs every feature whose applies returns true (or is absent)', () => {
    const a = vi.fn(() => [{ name: 'plugin-a' } as never])
    const b = vi.fn(() => [{ name: 'plugin-b' } as never])
    const features: RequestFeature[] = [
      { name: 'always-on', contributeModelAdapters: a },
      { name: 'gated-on', applies: () => true, contributeModelAdapters: b }
    ]
    const out = collectFromFeatures(makeScope(), features)
    expect(out.modelAdapters).toHaveLength(2)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('skips a feature whose applies returns false', () => {
    const contribute = vi.fn(() => [{ name: 'skipped' } as never])
    const out = collectFromFeatures(makeScope(), [
      { name: 'gated-off', applies: () => false, contributeModelAdapters: contribute }
    ])
    expect(out.modelAdapters).toEqual([])
    expect(contribute).not.toHaveBeenCalled()
  })

  it('treats a thrown applies as not applicable (does not crash)', () => {
    const contribute = vi.fn(() => [{ name: 'x' } as never])
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'flaky-applies',
        applies: () => {
          throw new Error('boom')
        },
        contributeModelAdapters: contribute
      }
    ])
    expect(out.modelAdapters).toEqual([])
    expect(contribute).not.toHaveBeenCalled()
  })

  it('isolates errors in one contribute method — other methods on same feature still run', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'partial-failure',
        contributeModelAdapters: () => {
          throw new Error('plugin failure')
        },
        contributeHooks: () => ({ onFinish: () => {} })
      }
    ])
    expect(out.modelAdapters).toEqual([])
    expect(out.hookParts).toHaveLength(1)
  })

  it('isolates errors in one feature — other features unaffected', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'broken',
        contributeModelAdapters: () => {
          throw new Error('boom')
        }
      },
      {
        name: 'healthy',
        contributeModelAdapters: () => [{ name: 'survives' } as never]
      }
    ])
    expect(out.modelAdapters).toHaveLength(1)
  })

  it('aggregates contributions across multiple features and aspects', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'web',
        contributeModelAdapters: () => [{ name: 'web-plugin' } as never]
      },
      {
        name: 'tracing',
        contributeHooks: () => ({ onFinish: () => {} })
      }
    ])
    expect(out.modelAdapters).toHaveLength(1)
    expect(out.hookParts).toHaveLength(1)
  })

  it('returns empty contributions when no features supplied', () => {
    const out = collectFromFeatures(makeScope(), [])
    expect(out).toEqual({ modelAdapters: [], hookParts: [] })
  })

  it('skips contribute methods that return undefined', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'no-op',
        contributeModelAdapters: () => undefined as never,
        contributeHooks: () => undefined as never
      }
    ])
    expect(out.modelAdapters).toEqual([])
    expect(out.hookParts).toEqual([])
  })
})
