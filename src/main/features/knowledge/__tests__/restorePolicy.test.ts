import type {
  RestoreOwnerProgressReadResult,
  RestoreOwnerSummaryReadResult
} from '@data/db/restore/portableProfileContracts'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createKnowledgeRestoreOwnerSummary,
  type KnowledgeRestoreOwnerProgress,
  type KnowledgeRestoreOwnerSummary,
  type KnowledgeRestoreProgress,
  type KnowledgeRestoreSummary,
  readKnowledgeRestoreProgress,
  readKnowledgeRestoreSummary,
  withKnowledgeRestoreProgress
} from '../restorePolicy'

function rebuildSummary(...baseIds: string[]): KnowledgeRestoreSummary {
  return {
    baseIds,
    readyBaseIds: [],
    rebuildBaseIds: baseIds,
    requiresRebuild: baseIds.length > 0
  }
}

describe('Knowledge restore ownership policy', () => {
  it('uses the shared typed owner-summary read contract', () => {
    expectTypeOf(
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        resources: []
      })
    ).toEqualTypeOf<KnowledgeRestoreOwnerSummary>()
    expectTypeOf(readKnowledgeRestoreSummary(undefined)).toEqualTypeOf<
      RestoreOwnerSummaryReadResult<KnowledgeRestoreSummary>
    >()
    expectTypeOf(readKnowledgeRestoreProgress(undefined, undefined, rebuildSummary())).toEqualTypeOf<
      RestoreOwnerProgressReadResult<KnowledgeRestoreProgress>
    >()
    expectTypeOf(
      withKnowledgeRestoreProgress(undefined, rebuildSummary(), { completedBaseIds: [] })
    ).toEqualTypeOf<KnowledgeRestoreOwnerProgress>()
  })

  it('derives base IDs only from direct children of the managed Knowledge root', () => {
    expect(
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        resources: [
          {
            livePath: 'Data/KnowledgeBase/kb-2',
            contentPaths: ['raw/source.md', '.cherry/index.sqlite']
          },
          { livePath: 'Data/KnowledgeBase/kb-1', contentPaths: ['raw/source.md'] }
        ]
      })
    ).toEqual({
      knowledge: {
        baseIds: ['kb-2', 'kb-1'],
        readyBaseIds: ['kb-2'],
        rebuildBaseIds: ['kb-1'],
        requiresRebuild: true
      }
    })
  })

  it('refuses a path that Backup misclassified as a Knowledge unit', () => {
    expect(() =>
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        resources: [{ livePath: 'Data/Files/kb-1', contentPaths: [] }]
      })
    ).toThrow(/outside its managed unit root/)
  })

  it('reads the new opaque owner bag without falling back from malformed owner state', () => {
    expect(
      readKnowledgeRestoreSummary({
        knowledge: rebuildSummary('kb-1')
      })
    ).toEqual({
      kind: 'ok',
      summary: rebuildSummary('kb-1')
    })

    expect(readKnowledgeRestoreSummary({ knowledge: { baseIds: ['kb-1'] } }, ['legacy-kb'])).toEqual({
      kind: 'invalid'
    })
  })

  it('reads the pre-release terminal summary only when no owner bag exists', () => {
    expect(readKnowledgeRestoreSummary(undefined, ['legacy-kb'])).toEqual({
      kind: 'ok',
      summary: rebuildSummary('legacy-kb')
    })
    expect(readKnowledgeRestoreSummary(undefined)).toEqual({ kind: 'missing' })
  })

  it('reads Knowledge progress from its opaque owner entry', () => {
    const summary = rebuildSummary('kb-1', 'kb-2')

    expect(
      readKnowledgeRestoreProgress({ knowledge: { completedBaseIds: ['kb-2'], abandoned: true } }, undefined, summary)
    ).toEqual({
      kind: 'ok',
      progress: { completedBaseIds: ['kb-2'], abandoned: true }
    })
    expect(readKnowledgeRestoreProgress({}, undefined, summary)).toEqual({
      kind: 'ok',
      progress: { completedBaseIds: [] }
    })
  })

  it('fails closed on malformed current progress without consulting legacy state', () => {
    const summary = rebuildSummary('kb-1')

    expect(
      readKnowledgeRestoreProgress(
        { knowledge: { completedBaseIds: ['outside-summary'] } },
        { completedBaseIds: ['kb-1'] },
        summary
      )
    ).toEqual({ kind: 'invalid' })
    expect(
      readKnowledgeRestoreProgress(
        { knowledge: { completedBaseIds: [], abandoned: false } },
        { completedBaseIds: ['kb-1'] },
        summary
      )
    ).toEqual({ kind: 'invalid' })
    expect(
      readKnowledgeRestoreProgress({ knowledge: { completedBaseIds: ['kb-1', 'kb-1'] } }, undefined, summary)
    ).toEqual({ kind: 'invalid' })
  })

  it('reads pre-release progress only when the entire owner bag is absent', () => {
    const summary = rebuildSummary('legacy-kb')

    expect(readKnowledgeRestoreProgress(undefined, { completedBaseIds: ['legacy-kb'] }, summary)).toEqual({
      kind: 'ok',
      progress: { completedBaseIds: ['legacy-kb'] }
    })
    expect(readKnowledgeRestoreProgress(undefined, undefined, summary)).toEqual({
      kind: 'ok',
      progress: { completedBaseIds: [] }
    })
  })

  it('updates only Knowledge progress and preserves every other owner entry', () => {
    const summary = rebuildSummary('kb-1')

    expect(
      withKnowledgeRestoreProgress({ futureOwner: { cursor: 3 } }, summary, {
        completedBaseIds: ['kb-1'],
        abandoned: true
      })
    ).toEqual({
      futureOwner: { cursor: 3 },
      knowledge: { completedBaseIds: ['kb-1'], abandoned: true }
    })
    expect(() => withKnowledgeRestoreProgress(undefined, summary, { completedBaseIds: ['outside-summary'] })).toThrow(
      /inconsistent/
    )
  })
})
