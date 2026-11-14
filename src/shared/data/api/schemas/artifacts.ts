import * as z from 'zod'

export const ARTIFACT_KINDS = ['page', 'media', 'file'] as const
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS)
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

/**
 * An output of an Agent or an Assistant: a file an Agent reported through `report_artifacts`, or an
 * image an Assistant generated.
 */
export const ArtifactEntitySchema = z.strictObject({
  id: z.string(),
  /** The Agent session or Assistant topic it came from. */
  sourceId: z.string(),
  sourceName: z.string(),
  /** Absolute path; set for Agent outputs. */
  path: z.string().optional(),
  /** Managed file; set for Assistant outputs. */
  fileEntryId: z.string().optional(),
  title: z.string(),
  kind: ArtifactKindSchema,
  /** Bytes when known at report time. */
  size: z.number().int().nonnegative().optional(),
  reportedAt: z.string()
})
export type ArtifactEntity = z.infer<typeof ArtifactEntitySchema>

export const ListArtifactsQuerySchema = z.strictObject({
  kind: ArtifactKindSchema.optional()
})
export type ListArtifactsQuery = z.infer<typeof ListArtifactsQuerySchema>

export const ARTIFACT_LIST_LIMIT = 200

export interface ArtifactList {
  /** The most recent outputs of the requested kind, newest first, at most {@link ARTIFACT_LIST_LIMIT}. */
  items: ArtifactEntity[]
  /** Totals of every kind, regardless of the requested kind. */
  counts: Record<'all' | ArtifactKind, number>
}

export type ArtifactSchemas = {
  /** Outputs of one Agent across its live sessions. Written by the `report_artifacts` tool. */
  '/agents/:agentId/artifacts': {
    GET: {
      params: { agentId: string }
      query?: ListArtifactsQuery
      response: ArtifactList
    }
  }
  /** Outputs of one Assistant across its live topics. Written by the `generate_image` tool. */
  '/assistants/:id/artifacts': {
    GET: {
      params: { id: string }
      query?: ListArtifactsQuery
      response: ArtifactList
    }
  }
}
