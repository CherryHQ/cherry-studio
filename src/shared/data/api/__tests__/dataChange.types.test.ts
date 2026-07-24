/**
 * Type-level tests for the DataApi data change notification protocol.
 *
 * Two irreplaceable jobs:
 * 1. Classification snapshot — `CollectionGetPaths` is DERIVED from GET
 *    response shapes, so "every path is classified" is vacuously true and
 *    cannot be a test. Instead the snapshot pins the exact membership: a
 *    schema change that flips a path's classification (or adds a GET read
 *    model) turns up here as a reviewable diff instead of silently changing
 *    protocol semantics.
 * 2. Illegal-state tripwires — the discriminated union makes four states
 *    unrepresentable; the `@ts-expect-error` cases below are the only proof
 *    that they stay unrepresentable.
 */
import { describe, expectTypeOf, it } from 'vitest'

import type { CollectionGetPaths, DataApiDataChangeEffect, GetMethodApiPaths, ScalarGetPaths } from '../types'

describe('endpoint classification', () => {
  it('pins the collection classification snapshot (update deliberately on schema changes)', () => {
    expectTypeOf<CollectionGetPaths>().toEqualTypeOf<
      | '/agent-channels'
      | '/agent-sessions'
      | '/agent-sessions/:sessionId/messages'
      | '/agent-tasks'
      | '/agent-workspaces'
      | '/agents'
      | '/agents/:agentId/tasks'
      | '/agents/:agentId/tasks/:taskId/logs'
      | '/assistants'
      | '/files/entries'
      | '/files/entries/:id/refs'
      | '/files/entries/ref-counts'
      | '/files/refs'
      | '/groups'
      | '/jobs'
      | '/knowledge-bases'
      | '/knowledge-bases/:id/items'
      | '/mcp-servers'
      | '/mini-apps'
      | '/models'
      | '/notes'
      | '/paintings'
      | '/pins'
      | '/prompts'
      | '/providers'
      | '/providers/:providerId/models:resolve'
      | '/skills'
      | '/tags'
      | '/tags/entities/:entityType/:entityId'
      | '/temporary/topics/:topicId/messages'
      | '/topics'
      | '/topics/:topicId/messages'
      | '/topics/:topicId/path'
      | '/translate/histories'
      | '/translate/languages'
    >()
  })

  it('classifies wrapper-object and single-entity responses as scalar', () => {
    // Wrapper objects not extending a pagination type degrade to scalar —
    // coarser but correct (no kind = whole-value refetch).
    expectTypeOf<'/topics/latest'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/topics/:id'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/search/entities'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/topics/:topicId/tree'>().toExtend<ScalarGetPaths>()
  })

  it('rejects paths without a GET read model as notification targets', () => {
    // POST-only — nothing readable to converge on.
    // @ts-expect-error '/messages/:id/siblings' declares no GET method
    expectTypeOf<'/messages/:id/siblings'>().toExtend<GetMethodApiPaths>()
  })
})

describe('DataApiDataChangeEffect invariants', () => {
  it('accepts every legal shape', () => {
    const legal: DataApiDataChangeEffect[] = [
      { endpoint: '/topics/latest' },
      { endpoint: '/topics/:id', entityIds: ['t1'] },
      { endpoint: '/topics', kind: 'projection', entityIds: ['t1'] },
      { endpoint: '/topics', kind: 'membership' },
      { endpoint: '/topics', kind: 'membership', dimension: 'search', entityIds: ['t1'] },
      { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt' }
    ]
    expectTypeOf(legal).toExtend<DataApiDataChangeEffect[]>()
  })

  it('keeps effect fields read-only for consumers', () => {
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection', entityIds: ['t1'] }

    // @ts-expect-error endpoint is read-only — effects are shared across listeners
    effect.endpoint = '/tags'

    // @ts-expect-error entityIds is a readonly array — no in-place mutation
    effect.entityIds?.push('t2')

    expectTypeOf(effect).toExtend<DataApiDataChangeEffect>()
  })

  it('keeps the four illegal states unrepresentable', () => {
    // @ts-expect-error collection endpoint requires a kind
    const collectionWithoutKind: DataApiDataChangeEffect = { endpoint: '/topics' }

    // @ts-expect-error scalar endpoint must not carry a kind
    const scalarWithKind: DataApiDataChangeEffect = { endpoint: '/topics/latest', kind: 'projection' }

    // @ts-expect-error order requires a dimension (an ordering profile)
    const orderWithoutDimension: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'order' }

    // @ts-expect-error projection must not carry a dimension
    const projectionWithDimension: DataApiDataChangeEffect = {
      endpoint: '/topics',
      kind: 'projection',
      dimension: 'search'
    }

    // @ts-expect-error endpoint is a schema TEMPLATE path, never a concrete one
    const concreteEndpoint: DataApiDataChangeEffect = { endpoint: '/topics/abc123' }

    expectTypeOf([
      collectionWithoutKind,
      scalarWithKind,
      orderWithoutDimension,
      projectionWithDimension,
      concreteEndpoint
    ]).toExtend<DataApiDataChangeEffect[]>()
  })
})
