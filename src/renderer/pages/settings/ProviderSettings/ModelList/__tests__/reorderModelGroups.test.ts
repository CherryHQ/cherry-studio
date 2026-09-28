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

// chat(0) = a1, vision(1) = b1, rerank(2) = d1
const threeGroups = () => [model('a1', 'chat'), model('b1', 'vision'), model('d1', 'rerank')]

describe('reorderModelGroups', () => {
  it('places a group after the target when it is dragged downward', () => {
    const next = reorderModelGroups({
      models: threeGroups(),
      activeGroupName: 'chat',
      overGroupName: 'rerank',
      sourceIndex: 0,
      targetIndex: 2
    })

    expect(ids(next)).toEqual(['openai::b1', 'openai::d1', 'openai::a1'])
  })

  it('places a group before the target when it is dragged upward', () => {
    const next = reorderModelGroups({
      models: threeGroups(),
      activeGroupName: 'rerank',
      overGroupName: 'chat',
      sourceIndex: 2,
      targetIndex: 0
    })

    expect(ids(next)).toEqual(['openai::d1', 'openai::a1', 'openai::b1'])
  })

  it('keeps a multi-row group intact when dragged downward', () => {
    const models = [model('a1', 'chat'), model('a2', 'chat'), model('b1', 'vision'), model('d1', 'rerank')]

    const next = reorderModelGroups({
      models,
      activeGroupName: 'chat',
      overGroupName: 'rerank',
      sourceIndex: 0,
      targetIndex: 2
    })

    expect(ids(next)).toEqual(['openai::b1', 'openai::d1', 'openai::a1', 'openai::a2'])
  })

  it('carries members hidden by a filter along with their group', () => {
    // `c1` is not visible on screen, but it belongs to chat and must not be
    // left behind when that group moves.
    const models = [model('a1', 'chat'), model('b1', 'vision'), model('c1', 'chat'), model('d1', 'rerank')]

    const next = reorderModelGroups({
      models,
      activeGroupName: 'chat',
      overGroupName: 'rerank',
      sourceIndex: 0,
      targetIndex: 2
    })

    expect(ids(next)).toEqual(['openai::b1', 'openai::d1', 'openai::a1', 'openai::c1'])
  })

  it('leaves the other rows in order when a middle group moves to the top', () => {
    const models = [model('a1', 'chat'), model('a2', 'chat'), model('b1', 'vision'), model('d1', 'rerank')]

    const next = reorderModelGroups({
      models,
      activeGroupName: 'vision',
      overGroupName: 'chat',
      sourceIndex: 1,
      targetIndex: 0
    })

    expect(ids(next)).toEqual(['openai::b1', 'openai::a1', 'openai::a2', 'openai::d1'])
  })

  it('is a no-op when a group is dropped on itself', () => {
    const models = threeGroups()

    expect(
      reorderModelGroups({
        models,
        activeGroupName: 'chat',
        overGroupName: 'chat',
        sourceIndex: 0,
        targetIndex: 0
      })
    ).toBe(models)
  })

  it('is a no-op for an unknown group name', () => {
    const models = threeGroups()

    expect(
      reorderModelGroups({ models, activeGroupName: 'nope', overGroupName: 'chat', sourceIndex: 0, targetIndex: 1 })
    ).toBe(models)
    expect(
      reorderModelGroups({ models, activeGroupName: 'chat', overGroupName: 'nope', sourceIndex: 0, targetIndex: 1 })
    ).toBe(models)
  })

  it('groups by the same rule the list renders, including the provider fallback', () => {
    // `bare` has no `group`, so with `preferModelGroup` it falls into the group
    // named after its provider — the block move must use that same name, not
    // the model id and not the ungrouped sentinel.
    const models = [model('bare'), model('a1', 'chat')]

    const next = reorderModelGroups({
      models,
      activeGroupName: 'openai',
      overGroupName: 'chat',
      sourceIndex: 0,
      targetIndex: 1
    })

    expect(ids(next)).toEqual(['openai::a1', 'openai::bare'])
  })
})
