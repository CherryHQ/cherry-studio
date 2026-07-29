import path from 'node:path'

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

export type KnowledgeRestoreSummaryRead =
  | { readonly kind: 'ok'; readonly summary: KnowledgeRestoreSummary }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }

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
}): { readonly knowledge: KnowledgeRestoreSummary } {
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
  ownerSummary: Readonly<Record<string, unknown>> | undefined,
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
