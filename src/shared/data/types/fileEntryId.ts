import * as z from 'zod'

/**
 * File entry ID: UUID. New v2 entries are v7, while migrated entries may be
 * v4, so cross-table references accept any UUID version.
 */
export const FileEntryIdSchema = z.uuid()
export type FileEntryId = z.infer<typeof FileEntryIdSchema>
