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
 * - `handle` is the **model-facing** opaque name, deterministically derived from
 *   `fileEntryId`. It's what the model echoes back to attachment tools and the
 *   only name that resolves, so deleting another message or renaming the file
 *   cannot rebind an older handle.
 * - `displayName` is the original filename, kept for logs/observability.
 *
 * The internal `fileEntryId` never reaches the model.
 */
export interface FileAttachmentRef {
  readonly fileEntryId: string
  readonly handle: string
  readonly displayName: string
}
