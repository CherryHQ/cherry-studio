import { describe, expect, it } from 'vitest'

import { scopeModelRefresh } from '../scopeModelRefresh'

describe('scoped model refresh', () => {
  const current = {
    models: [
      { id: 'existing', name: 'Original name' },
      { id: 'argon', name: 'Old name' }
    ],
    overrides: [
      { providerId: 'host', modelId: 'existing', price: 1 },
      { providerId: 'removed-host', modelId: 'argon', price: 2 }
    ]
  }
  const generated = {
    models: [
      { id: 'existing', name: 'Unrelated rename' },
      { id: 'argon', name: 'Argon' },
      { id: 'new', name: 'New' }
    ],
    overrides: [
      { providerId: 'host', modelId: 'existing', price: 99 },
      { providerId: 'new-host', modelId: 'argon', price: 3 },
      { providerId: 'new-host', modelId: 'new', price: 4 }
    ]
  }

  it('updates the selected model and replaces its offers while preserving unrelated rows', () => {
    const result = scopeModelRefresh(current, generated, ['argon'])
    expect(result).toEqual({
      models: [
        { id: 'existing', name: 'Original name' },
        { id: 'argon', name: 'Argon' }
      ],
      overrides: [
        { providerId: 'host', modelId: 'existing', price: 1 },
        { providerId: 'new-host', modelId: 'argon', price: 3 }
      ]
    })
    expect(current.models[1].name).toBe('Old name')
  })

  it('adds a selected new model once and retains old models missing from upstream', () => {
    const result = scopeModelRefresh(current, { models: [generated.models[2]], overrides: [generated.overrides[2]] }, [
      'new',
      'new'
    ])
    expect(result.models).toEqual([...current.models, { id: 'new', name: 'New' }])
    expect(result.overrides).toEqual([...current.overrides, { providerId: 'new-host', modelId: 'new', price: 4 }])
  })

  it('rejects unknown IDs instead of silently dropping current models', () => {
    expect(() => scopeModelRefresh(current, generated, ['unknown'])).toThrow('unknown canonical model: unknown')
    expect(() => scopeModelRefresh(current, { models: [], overrides: [] }, ['argon'])).toThrow(
      'unknown canonical model: argon'
    )
  })
})
