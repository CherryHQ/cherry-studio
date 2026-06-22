/**
 * Shared attachment-domain types for the chat path. Neutral home so message
 * preparation (`attachmentRouting`), the AI-SDK tool adapter context, and the
 * `read_file` tool all reference the same shape without coupling through any one
 * of them.
 */

/**
 * One attachment the `read_file` tool may read this request, and an entry in the
 * per-request allow-list.
 *
 * - `handle` is the **model-facing** name: normalized + made unique across the
 *   request (duplicates get ` (2)`, ` (3)`, …). It's what the model echoes back
 *   to `read_file` and the only name that resolves — so it must be stable and
 *   unambiguous.
 * - `displayName` is the original filename, kept for logs/observability.
 *
 * The internal `fileEntryId` never reaches the model.
 */
export interface FileAttachmentRef {
  readonly fileEntryId: string
  readonly handle: string
  readonly displayName: string
}
