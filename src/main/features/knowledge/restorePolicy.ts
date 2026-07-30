import path from 'node:path'

import type {
  RestoreOwnerProgressBag,
  RestoreOwnerProgressReadResult,
  RestoreOwnerSummaryBag,
  RestoreOwnerSummaryReadResult
} from '@data/portableProfilePolicy'
import * as z from 'zod'

const MAX_RESTORED_KNOWLEDGE_BASES = 50_000

const KnowledgeRestoreSummarySchema = z
  .strictObject({
    baseIds: z
      .array(z.string().min(1))
      .max(MAX_RESTORED_KNOWLEDGE_BASES)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'restored Knowledge base IDs must be unique'
      }),
    requiresRebuild: z.boolean()
  })
  .refine((summary) => summary.requiresRebuild || summary.baseIds.length === 0, {
    message: 'a restore that does not require rebuilding cannot name Knowledge bases'
  })

export type KnowledgeRestoreSummary = z.infer<typeof KnowledgeRestoreSummarySchema>

export interface KnowledgeRestoreOwnerSummary extends RestoreOwnerSummaryBag {
  readonly knowledge: KnowledgeRestoreSummary
}

export type KnowledgeRestoreSummaryRead = RestoreOwnerSummaryReadResult<KnowledgeRestoreSummary>

const KnowledgeRestoreProgressSchema = z.strictObject({
  completedBaseIds: z
    .array(z.string().min(1))
    .max(MAX_RESTORED_KNOWLEDGE_BASES)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'completed Knowledge base IDs must be unique'
    }),
  abandoned: z.literal(true).optional()
})

export type KnowledgeRestoreProgress = z.infer<typeof KnowledgeRestoreProgressSchema>

export interface KnowledgeRestoreOwnerProgress extends RestoreOwnerProgressBag {
  readonly knowledge: KnowledgeRestoreProgress
}

export type KnowledgeRestoreProgressRead = RestoreOwnerProgressReadResult<KnowledgeRestoreProgress>

/**
 * Seal the Knowledge-owned projection of verified restore payloads.
 *
 * Backup supplies only live paths already classified as `knowledge-base`.
 * Knowledge still validates that each path is one direct child of its managed
 * root before turning the child name into a business ID.
 */
export function createKnowledgeRestoreOwnerSummary(input: {
  readonly userDataPath: string
  readonly knowledgeRoot: string
  readonly livePaths: readonly string[]
}): KnowledgeRestoreOwnerSummary {
  const root = path.resolve(input.knowledgeRoot)
  const baseIds: string[] = []
  const seen = new Set<string>()

  for (const livePath of input.livePaths) {
    const absolute = path.resolve(input.userDataPath, ...livePath.split('/'))
    if (path.dirname(absolute) !== root) {
      throw new Error('Knowledge restore projection contains a path outside its managed unit root')
    }
    const baseId = path.basename(absolute)
    if (seen.has(baseId)) continue
    seen.add(baseId)
    baseIds.push(baseId)
  }

  return {
    knowledge: {
      baseIds,
      requiresRebuild: baseIds.length > 0
    }
  }
}

/**
 * Interpret the opaque journal bag at the Knowledge owner boundary.
 *
 * `legacyKnowledgeBaseIds` is accepted only when the whole owner bag is absent,
 * so malformed new-format state never silently falls back to an older reading.
 */
export function readKnowledgeRestoreSummary(
  ownerSummary: RestoreOwnerSummaryBag | undefined,
  legacyKnowledgeBaseIds?: readonly string[]
): KnowledgeRestoreSummaryRead {
  if (ownerSummary !== undefined) {
    const parsed = KnowledgeRestoreSummarySchema.safeParse(ownerSummary.knowledge)
    return parsed.success ? { kind: 'ok', summary: parsed.data } : { kind: 'invalid' }
  }
  if (legacyKnowledgeBaseIds === undefined) return { kind: 'missing' }

  const parsed = KnowledgeRestoreSummarySchema.safeParse({
    baseIds: legacyKnowledgeBaseIds,
    requiresRebuild: legacyKnowledgeBaseIds.length > 0
  })
  return parsed.success ? { kind: 'ok', summary: parsed.data } : { kind: 'invalid' }
}

function parseKnowledgeRestoreProgress(value: unknown, summary: KnowledgeRestoreSummary): KnowledgeRestoreProgressRead {
  const parsed = KnowledgeRestoreProgressSchema.safeParse(value)
  if (!parsed.success) return { kind: 'invalid' }
  const allowed = new Set(summary.baseIds)
  if (parsed.data.completedBaseIds.some((baseId) => !allowed.has(baseId))) {
    return { kind: 'invalid' }
  }
  return { kind: 'ok', progress: parsed.data }
}

/**
 * Interpret Knowledge progress without teaching the journal its schema.
 *
 * A missing Knowledge entry means no base has completed yet. The pre-release
 * `knowledgeRebuild` field is consulted only when the whole owner-progress bag
 * is absent, so malformed current state can never be hidden by legacy data.
 */
export function readKnowledgeRestoreProgress(
  ownerProgress: RestoreOwnerProgressBag | undefined,
  legacyKnowledgeRebuild: unknown,
  summary: KnowledgeRestoreSummary
): KnowledgeRestoreProgressRead {
  if (ownerProgress !== undefined) {
    if (ownerProgress.knowledge === undefined) {
      return { kind: 'ok', progress: { completedBaseIds: [] } }
    }
    return parseKnowledgeRestoreProgress(ownerProgress.knowledge, summary)
  }
  if (legacyKnowledgeRebuild === undefined) {
    return { kind: 'ok', progress: { completedBaseIds: [] } }
  }
  return parseKnowledgeRestoreProgress(legacyKnowledgeRebuild, summary)
}

/** Replace only Knowledge's entry while preserving every other owner's progress. */
export function withKnowledgeRestoreProgress(
  ownerProgress: RestoreOwnerProgressBag | undefined,
  summary: KnowledgeRestoreSummary,
  progress: KnowledgeRestoreProgress
): KnowledgeRestoreOwnerProgress {
  const parsed = parseKnowledgeRestoreProgress(progress, summary)
  if (parsed.kind !== 'ok') {
    throw new Error('Knowledge restore progress is inconsistent with its owner summary')
  }
  return { ...ownerProgress, knowledge: parsed.progress }
}
