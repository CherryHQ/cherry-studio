import * as z from 'zod'

/** The active request mode; persisted steps also record their operation and parameter snapshot. */
export const PaintingModeSchema = z.string().trim().min(1)
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingFilesSchema = z.strictObject({
  output: z.array(z.string()),
  input: z.array(z.string())
})
export type PaintingFiles = z.infer<typeof PaintingFilesSchema>

export const PaintingStepStatusSchema = z.enum(['running', 'completed', 'failed', 'canceled', 'interrupted'])
export type PaintingStepStatus = z.infer<typeof PaintingStepStatusSchema>
export const PaintingStepFields = {
  stepNumber: z.number().int().positive().optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sourceFileId: z.string().nullable().optional(),
  operation: z.enum(['generate', 'edit', 'import']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  stepStatus: PaintingStepStatusSchema.optional(),
  stepError: z.string().nullable().optional(),
  selectedStepId: z.string().nullable().optional(),
  selectedFileId: z.string().nullable().optional()
}

export const PaintingSchema = z.strictObject({
  ...PaintingStepFields,
  id: z.string(),
  providerId: z.string(),
  modelId: z.string().nullable().optional(),
  prompt: z.string(),
  files: PaintingFilesSchema,
  /**
   * Stable snapshot of the referenced FileEntry rows consumed by painting history hydration.
   * List/get responses populate it so renderer caches can reject stale file metadata without
   * repeating per-entry DataApi and physical-path IPC on an unchanged refresh.
   */
  fileDataFingerprint: z.string().optional(),
  previewFileId: z.string().optional(),
  orderKey: z.string().min(1),
  // ISO 8601 (matches the assistant/topic/tag/note/prompt convention); the
  // service emits these via `timestampToISO`. `id` stays `z.string()` because
  // migration supplies opaque ids.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /**
   * Read-only trash marker — present only on trashed paintings. Set via
   * `DELETE /paintings/:id` (move to Recycle Bin) and cleared via
   * `POST /paintings/:id/restore`; never writable through create/update DTOs.
   */
  deletedAt: z.iso.datetime().optional()
})

export type Painting = z.infer<typeof PaintingSchema>
