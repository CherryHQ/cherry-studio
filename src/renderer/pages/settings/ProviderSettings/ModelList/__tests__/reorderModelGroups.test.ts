import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { reorderModelGroups } from '../reorderModelGroups'

const model = (modelId: string, group?: string): Model =>
  ({
    id: `openai::${modelId}`,
    name: modelId,
    providerId: 'openai',
    group,
    capabilities: [],
    isEnabled: true
  }) as unknown as Model

const ids = (models: readonly Model[]) => models.map((m) => m.id)

describe('reorderModelGroups', () => {
  it('moves a whole group before the group it was dropped on', () => {
    const models = [model('a1', 'chat'), model('b1', 'vision'), model('c1', 'chat'), model('d1', 'rerank')]

    const next = reorderModelGroups({ models, activeGroupName: 'vision', overGroupName: 'rerank' })

    expect(ids(next)).toEqual(['openai::a1', 'openai::c1', 'openai::b1', 'openai::d1'])
  })

  it('carries members hidden by a filter along with their group', () => {
    // `c1` is not visible on screen, but it belongs to the chat group and must
    // not be left behind when that group moves.
    const models = [model('a1', 'chat'), model('b1', 'vision'), model('c1', 'chat'), model('d1', 'rerank')]

    const next = reorderModelGroups({ models, activeGroupName: 'chat', overGroupName: 'rerank' })

    expect(ids(next)).toEqual(['openai::b1', 'openai::a1', 'openai::c1', 'openai::d1'])
  })

  it('keeps the rest of the list in order when a middle group moves to the top', () => {
    const models = [model('a1', 'chat'), model('a2', 'chat'), model('b1', 'vision'), model('c1', 'rerank')]

    const next = reorderModelGroups({ models, activeGroupName: 'vision', overGroupName: 'chat' })

    expect(ids(next)).toEqual(['openai::b1', 'openai::a1', 'openai::a2', 'openai::c1'])
  })

  it('is a no-op when a group is dropped on itself', () => {
    const models = [model('a1', 'chat'), model('b1', 'vision')]

    expect(reorderModelGroups({ models, activeGroupName: 'chat', overGroupName: 'chat' })).toBe(models)
  })

  it('is a no-op for an unknown group name', () => {
    const models = [model('a1', 'chat'), model('b1', 'vision')]

    expect(reorderModelGroups({ models, activeGroupName: 'nope', overGroupName: 'chat' })).toBe(models)
    expect(reorderModelGroups({ models, activeGroupName: 'chat', overGroupName: 'nope' })).toBe(models)
  })

  it('groups by the same rule the list renders, including the ungrouped fallback', () => {
    // `bare` has no group, so it lands in the ungrouped bucket; the model id
    // alone must not be mistaken for a group name.
    const models = [model('bare'), model('a1', 'chat')]

    const next = reorderModelGroups({ models, activeGroupName: '__ungrouped__', overGroupName: 'chat' })

    expect(ids(next)).toEqual(['openai::bare', 'openai::a1'])
  })
})
