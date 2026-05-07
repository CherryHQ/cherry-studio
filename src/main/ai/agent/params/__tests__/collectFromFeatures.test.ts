import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { ToolEntry, ToolNamespace } from '../../../tools/types'
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
    mcpToolIds: new Set(),
    workspaceRoot: null,
    contextSettings: DEFAULT_CONTEXT_SETTINGS,
    compressionModel: null
  }
}

function makeEntry(name: string): ToolEntry {
  return {
    name,
    namespace: 'test' as ToolNamespace,
    description: `${name} description`,
    defer: 'never',
    tool: { description: '' } as unknown as Tool
  }
}

describe('collectFromFeatures', () => {
  it('runs every feature whose applies returns true (or is absent)', () => {
    const a = vi.fn(() => [makeEntry('a')])
    const b = vi.fn(() => [makeEntry('b')])
    const features: RequestFeature[] = [
      { name: 'always-on', contributeTools: a },
      { name: 'gated-on', applies: () => true, contributeTools: b }
    ]
    const out = collectFromFeatures(makeScope(), features)
    expect(out.ephemeralEntries.map((e) => e.name)).toEqual(['a', 'b'])
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('skips a feature whose applies returns false', () => {
    const contribute = vi.fn(() => [makeEntry('skipped')])
    const out = collectFromFeatures(makeScope(), [
      { name: 'gated-off', applies: () => false, contributeTools: contribute }
    ])
    expect(out.ephemeralEntries).toEqual([])
    expect(contribute).not.toHaveBeenCalled()
  })

  it('treats a thrown applies as not applicable (does not crash)', () => {
    const contribute = vi.fn(() => [makeEntry('x')])
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'flaky-applies',
        applies: () => {
          throw new Error('boom')
        },
        contributeTools: contribute
      }
    ])
    expect(out.ephemeralEntries).toEqual([])
    expect(contribute).not.toHaveBeenCalled()
  })

  it('isolates errors in one contribute method — other methods on same feature still run', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'partial-failure',
        contributeTools: () => {
          throw new Error('tool failure')
        },
        contributeSystemSection: () => ({ key: 'fallback', text: 'still here' })
      }
    ])
    expect(out.ephemeralEntries).toEqual([])
    expect(out.systemSections).toEqual([{ key: 'fallback', text: 'still here' }])
  })

  it('isolates errors in one feature — other features unaffected', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'broken',
        contributeTools: () => {
          throw new Error('boom')
        }
      },
      {
        name: 'healthy',
        contributeTools: () => [makeEntry('survives')]
      }
    ])
    expect(out.ephemeralEntries.map((e) => e.name)).toEqual(['survives'])
  })

  it('aggregates contributions across multiple features and aspects', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'kb',
        contributeTools: () => [makeEntry('kb__search')],
        contributeSystemSection: () => ({ key: 'kb-hint', text: 'use kb' })
      },
      {
        name: 'web',
        contributeTools: () => [makeEntry('web__search'), makeEntry('web__fetch')],
        contributeModelAdapters: () => [{ name: 'web-plugin' } as never]
      },
      {
        name: 'tracing',
        contributeHooks: () => ({ onFinish: () => {} })
      }
    ])
    expect(out.ephemeralEntries.map((e) => e.name)).toEqual(['kb__search', 'web__search', 'web__fetch'])
    expect(out.systemSections).toEqual([{ key: 'kb-hint', text: 'use kb' }])
    expect(out.modelAdapters).toHaveLength(1)
    expect(out.hookParts).toHaveLength(1)
  })

  it('returns empty contributions when no features supplied', () => {
    const out = collectFromFeatures(makeScope(), [])
    expect(out).toEqual({ ephemeralEntries: [], systemSections: [], modelAdapters: [], hookParts: [] })
  })

  it('skips contribute methods that return undefined', () => {
    const out = collectFromFeatures(makeScope(), [
      {
        name: 'no-op',
        contributeTools: () => undefined as never,
        contributeSystemSection: () => undefined as never
      }
    ])
    expect(out.ephemeralEntries).toEqual([])
    expect(out.systemSections).toEqual([])
  })
})
