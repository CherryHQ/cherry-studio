import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import { groupProvidersByPreset, restoreProviderStatusSlots } from '../providerGrouping'

function provider(id: string, presetProviderId?: string): Provider {
  return {
    id,
    name: id,
    presetProviderId,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled: true
  } as unknown as Provider
}

describe('groupProvidersByPreset', () => {
  it('keeps single-instance presets flat', () => {
    const entries = groupProvidersByPreset([provider('openai', 'openai'), provider('anthropic', 'anthropic')])

    expect(entries).toEqual([
      { kind: 'single', provider: expect.objectContaining({ id: 'openai' }) },
      { kind: 'single', provider: expect.objectContaining({ id: 'anthropic' }) }
    ])
  })

  it('keeps fully custom providers (no presetProviderId) flat', () => {
    const entries = groupProvidersByPreset([provider('custom-1'), provider('custom-2')])

    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.kind === 'single')).toBe(true)
  })

  it('folds ≥2 same-preset providers into a single group entry', () => {
    const entries = groupProvidersByPreset([
      provider('azure-1', 'azure-openai'),
      provider('azure-2', 'azure-openai'),
      provider('azure-3', 'azure-openai')
    ])

    expect(entries).toEqual([
      {
        kind: 'group',
        presetProviderId: 'azure-openai',
        members: [
          expect.objectContaining({ id: 'azure-1' }),
          expect.objectContaining({ id: 'azure-2' }),
          expect.objectContaining({ id: 'azure-3' })
        ]
      }
    ])
  })

  it('anchors the group at the first member position, preserving overall order', () => {
    const entries = groupProvidersByPreset([
      provider('anthropic', 'anthropic'),
      provider('azure-1', 'azure-openai'),
      provider('openai', 'openai'),
      provider('azure-2', 'azure-openai')
    ])

    expect(
      entries.map((e) => (e.kind === 'group' ? `group:${e.presetProviderId}` : `single:${e.provider.id}`))
    ).toEqual(['single:anthropic', 'group:azure-openai', 'single:openai'])

    const group = entries[1]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.members.map((m) => m.id)).toEqual(['azure-1', 'azure-2'])
    }
  })

  it('does not fold a preset that has exactly 1 member, even alongside other groups', () => {
    const entries = groupProvidersByPreset([
      provider('azure-1', 'azure-openai'),
      provider('vertex-only', 'vertexai'),
      provider('azure-2', 'azure-openai')
    ])

    expect(entries).toEqual([
      expect.objectContaining({ kind: 'group', presetProviderId: 'azure-openai' }),
      expect.objectContaining({ kind: 'single' })
    ])

    const single = entries[1]
    if (single.kind === 'single') {
      expect(single.provider.presetProviderId).toBe('vertexai')
    }
  })

  it('returns [] for empty input', () => {
    expect(groupProvidersByPreset([])).toEqual([])
  })
})

describe('restoreProviderStatusSlots', () => {
  it('preserves interleaved storage slots while reordering both partitions', () => {
    const a = provider('a'),
      b = provider('b'),
      d = { ...provider('d'), isEnabled: false },
      e = { ...provider('e'), isEnabled: false }
    const all = [d, a, e, b]
    expect(restoreProviderStatusSlots(all, [b, a, e, d]).map((p) => p.id)).toEqual(['e', 'b', 'd', 'a'])
  })
  it('returns the stored baseline for a display-only cross-status move', () => {
    const a = provider('a'),
      b = provider('b'),
      d = { ...provider('d'), isEnabled: false }
    const all = [d, a, b]
    expect(restoreProviderStatusSlots(all, [a, d, b])).toBe(all)
  })
})
