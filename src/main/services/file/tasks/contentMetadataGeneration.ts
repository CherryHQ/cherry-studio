import { and, eq, isNotNull, sql } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { fileEntryTable } from '@data/db/schemas/file'

const CONTENT_METADATA_GENERATION_KEY = 'fileManager:contentMetadataGeneration'
const CONTENT_METADATA_GENERATION_VERSION = 2

const ContentMetadataGenerationSchema = z.strictObject({
  version: z.number().int()
})

export interface ContentMetadataGenerationResult {
  readonly invalidated: number
  readonly applied: boolean
}

/**
 * Invalidate hashes produced before the recoverable content-commit protocol.
 *
 * The marker and invalidation share one synchronous transaction: after any
 * crash either both are visible or neither is. Directly assigning updatedAt
 * to itself bypasses Drizzle's $onUpdateFn and preserves Files ordering.
 */
export function ensureContentMetadataGeneration(): ContentMetadataGenerationResult {
  return application.get('DbService').withWriteTx((tx) => {
    const marker = tx
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, CONTENT_METADATA_GENERATION_KEY))
      .get()
    const parsed = ContentMetadataGenerationSchema.safeParse(marker?.value)
    if (parsed.success && parsed.data.version === CONTENT_METADATA_GENERATION_VERSION) {
      return { invalidated: 0, applied: false }
    }

    const invalidated = tx
      .update(fileEntryTable)
      .set({
        contentHash: null,
        updatedAt: sql`${fileEntryTable.updatedAt}`
      })
      .where(and(eq(fileEntryTable.origin, 'internal'), isNotNull(fileEntryTable.contentHash)))
      .run().changes

    const now = Date.now()
    tx.insert(appStateTable)
      .values({
        key: CONTENT_METADATA_GENERATION_KEY,
        value: { version: CONTENT_METADATA_GENERATION_VERSION },
        description: 'Version of trusted FileManager bytes-derived metadata',
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: appStateTable.key,
        set: {
          value: { version: CONTENT_METADATA_GENERATION_VERSION },
          description: 'Version of trusted FileManager bytes-derived metadata',
          updatedAt: now
        }
      })
      .run()

    return { invalidated, applied: true }
  })
}
