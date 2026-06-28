/**
 * General file module types — used across ops, FileManager, and IPC.
 */

import * as z from 'zod'

// ─── File Type Classification ───

export const FILE_TYPE = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text',
  DOCUMENT: 'document',
  OTHER: 'other'
} as const

export const FileTypeSchema = z.enum([
  FILE_TYPE.IMAGE,
  FILE_TYPE.VIDEO,
  FILE_TYPE.AUDIO,
  FILE_TYPE.TEXT,
  FILE_TYPE.DOCUMENT,
  FILE_TYPE.OTHER
])

export type FileType = z.infer<typeof FileTypeSchema>

// ─── Content Source Types ───

/**
 * Local filesystem path (absolute Unix or Windows).
 *
 * Runtime validation required — the template-literal pattern only provides
 * type-level hints. Rejects `file://` URLs; use a dedicated URL type (or plain
 * `string`) when a consumer needs to accept URLs.
 */
export type FilePath = `/${string}` | `${string}:\\${string}`
export type Base64String = `data:${string};base64,${string}`
export type UrlString = `http://${string}` | `https://${string}`

// ─── File Extension ───

/**
 * Conservative bare file-extension schema.
 *
 * Design intent:
 * - extension values are suffixes only (`pdf`, `md`, `gz`) — never `.pdf`
 * - multi-part names like `archive.tar.gz` split as `name='archive.tar'`,
 *   `ext='gz'`
 * - extensionless files should use `null`, not empty string / whitespace
 * - dots and whitespace are rejected so OS-default-open safety checks cannot
 *   be bypassed by platform-normalized suffixes such as `exe.` or `exe `
 * - separators and null bytes are rejected so an extension cannot become more
 *   than one path segment when composed into `{id}.{ext}` for internal-entry
 *   writes (managed-directory escape / truncation risk)
 */
// TODO(file-ext): Refactor this into a branded bare-extension type, then make
// `normalizeExt` the factory that returns that branded value or `null`.
export const SafeExtSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0'), 'Extension must not contain null bytes')
  .refine((s) => !/[/\\]/.test(s), 'Extension must not contain path separators')
  .refine((s) => !s.includes('.'), 'Extension must be bare (no dots), e.g. "pdf" not ".pdf"')
  .refine((s) => !/\s/.test(s), 'Extension must not contain whitespace')

/**
 * `file://` URL pointing at a local resource.
 *
 * Runtime validation required — the template-literal pattern only provides a
 * type-level hint. Produced by the shared pure helper
 * `toSafeFileUrl(path, ext)` (in `@shared/utils/file/url`), which composes an
 * absolute `FilePath` (obtained from File IPC `getPhysicalPath` /
 * `batchGetPhysicalPaths`) with a danger-file safety wrap (for
 * `.sh` / `.bat` / `.ps1` / `.exe` / `.app` etc., the URL points at the
 * containing directory instead of the file).
 *
 * Keep this distinct from `UrlString` (http/https) so signatures can refuse
 * the wrong family.
 *
 * The safety wrap is scoped to HTML rendering contexts (`<img src>` /
 * `<video src>` / `<embed>`); it is **not** a general-purpose path-safety
 * primitive — don't compose this value into shell commands or subprocess args.
 * Use the raw `FilePath` from `getPhysicalPath` for those cases.
 */
export type FileUrlString = `file://${string}`

export type FileContent = FilePath | Base64String | UrlString | Uint8Array

// ─── Physical File Metadata ───

const physicalMetadataBaseSchema = {
  size: z.int().nonnegative(),
  createdAt: z.number().nonnegative(),
  modifiedAt: z.number().nonnegative()
}

const physicalFileMetadataBaseSchema = {
  ...physicalMetadataBaseSchema,
  kind: z.literal('file'),
  mime: z.string()
}

const PhysicalDirectoryMetadataSchema = z.strictObject({
  ...physicalMetadataBaseSchema,
  kind: z.literal('directory')
})

const PhysicalFileKindMetadataSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.IMAGE),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional()
  }),
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.DOCUMENT),
    pageCount: z.int().nonnegative().optional()
  }),
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.TEXT),
    encoding: z.string().optional()
  }),
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.AUDIO)
  }),
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.VIDEO)
  }),
  z.strictObject({
    ...physicalFileMetadataBaseSchema,
    type: z.literal(FILE_TYPE.OTHER)
  })
])

/** Physical file metadata (size, timestamps, and optional type-specific enrichment like dimensions/pageCount). */
export const PhysicalFileMetadataSchema = z.discriminatedUnion('kind', [
  PhysicalDirectoryMetadataSchema,
  PhysicalFileKindMetadataSchema
])

export type PhysicalFileMetadata = z.infer<typeof PhysicalFileMetadataSchema>

// ─── Directory Listing Options ───

export interface DirectoryListOptions {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}
