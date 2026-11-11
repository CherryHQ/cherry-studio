import { describe, expectTypeOf, it } from 'vitest'

import type { DataApiDataChangeEffect, GetMethodApiPaths, ScalarGetPaths } from '../types'

describe('endpoint classification', () => {
  it('classifies wrapper-object and single-entity responses as scalar', () => {
    // Wrapper objects not extending a pagination type degrade to scalar —
    // coarser but correct (no kind = whole-value refetch).
    expectTypeOf<'/topics/latest'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/topics/:id'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/search/entities'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/topics/:topicId/tree'>().toExtend<ScalarGetPaths>()
    expectTypeOf<'/agent-tasks/:taskId'>().toExtend<ScalarGetPaths>()
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
      { endpoint: '/topics/:id', routeParams: { id: 't1' }, entityIds: ['t1'] },
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

    const scopedEffect: DataApiDataChangeEffect = {
      endpoint: '/topics/:id',
      routeParams: { id: 't1' },
      entityIds: ['t1']
    }
    // @ts-expect-error concrete route scope is read-only for shared listeners
    scopedEffect.routeParams!.id = 't2'

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
