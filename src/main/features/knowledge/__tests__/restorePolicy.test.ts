import type { RestoreOwnerSummaryReadResult } from '@data/portableProfilePolicy'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createKnowledgeRestoreOwnerSummary,
  type KnowledgeRestoreOwnerSummary,
  type KnowledgeRestoreSummary,
  readKnowledgeRestoreSummary
} from '../restorePolicy'

describe('Knowledge restore ownership policy', () => {
  it('uses the shared typed owner-summary read contract', () => {
    expectTypeOf(
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        livePaths: []
      })
    ).toEqualTypeOf<KnowledgeRestoreOwnerSummary>()
    expectTypeOf(readKnowledgeRestoreSummary(undefined)).toEqualTypeOf<
      RestoreOwnerSummaryReadResult<KnowledgeRestoreSummary>
    >()
  })

  it('derives base IDs only from direct children of the managed Knowledge root', () => {
    expect(
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        livePaths: ['Data/KnowledgeBase/kb-2', 'Data/KnowledgeBase/kb-1']
      })
    ).toEqual({
      knowledge: {
        baseIds: ['kb-2', 'kb-1'],
        requiresRebuild: true
      }
    })
  })

  it('refuses a path that Backup misclassified as a Knowledge unit', () => {
    expect(() =>
      createKnowledgeRestoreOwnerSummary({
        userDataPath: '/profile',
        knowledgeRoot: '/profile/Data/KnowledgeBase',
        livePaths: ['Data/Files/kb-1']
      })
    ).toThrow(/outside its managed unit root/)
  })

  it('reads the new opaque owner bag without falling back from malformed owner state', () => {
    expect(
      readKnowledgeRestoreSummary({
        knowledge: { baseIds: ['kb-1'], requiresRebuild: true }
      })
    ).toEqual({
      kind: 'ok',
      summary: { baseIds: ['kb-1'], requiresRebuild: true }
    })

    expect(readKnowledgeRestoreSummary({ knowledge: { baseIds: ['kb-1'] } }, ['legacy-kb'])).toEqual({
      kind: 'invalid'
    })
  })

  it('reads the pre-release terminal summary only when no owner bag exists', () => {
    expect(readKnowledgeRestoreSummary(undefined, ['legacy-kb'])).toEqual({
      kind: 'ok',
      summary: { baseIds: ['legacy-kb'], requiresRebuild: true }
    })
    expect(readKnowledgeRestoreSummary(undefined)).toEqual({ kind: 'missing' })
  })
})
