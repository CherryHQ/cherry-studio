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
 * Absolute filesystem path validated by `AbsoluteFilePathSchema`. Validates the path
 * SHAPE only — absolute form, no null bytes — and does NOT canonicalize:
 * `AbsoluteFilePathSchema.parse(x)` returns `x` unchanged (the path exactly as given).
 *
 * The canonical form of a path (byte-faithful lexical resolve: segment-resolve
 * + trailing-separator strip + drive-letter upcase, NOT Unicode-normalized) is
 * a distinct `CanonicalFilePath` produced by `canonicalizeFilePath()`
 * (`@shared/utils/file/canonicalize`); it is applied explicitly at the
 * external-path persistence / lookup boundary, not on every `AbsoluteFilePath` parse.
 * Not every `AbsoluteFilePath` HAS a canonical form — UNC does not, so
 * `canonicalizeFilePath()` on an already-branded value can still throw.
 *
 * The `z.brand` is a phantom brand — zero runtime cost, dropped on IPC
 * serialization; receivers re-assert via `AbsoluteFilePathSchema.parse()` at the
 * trusted boundary. Construction:
 * - Production: `AbsoluteFilePathSchema.parse(raw)` / `.safeParse(raw)`
 * - Tests / fixtures: `'…' as AbsoluteFilePath` for readability
 *
 * Accepts POSIX (`/…`), Windows drive (`X:\…` or `X:/…`) and Windows UNC
 * (`\\server\share\…`) absolute forms. Rejects `file://` URLs.
 *
 * UNC is accepted because it *is* an absolute filesystem path and Node's `fs`
 * reads it natively on Windows: this brand gates path SHAPE, and excluding a
 * legitimate shape silently downgraded network-share flows (a `file://` UNC
 * snapshot became an unreadable, dropped attachment). Accepting it here does
 * **not** make UNC a valid external-entry key — `canonicalizeFilePath` rejects
 * UNC explicitly, because the byte-faithful canonical form has no defined
 * `\\server\share` root handling. Feeding UNC to `fs` is fine; persisting it
 * as a dedup key is not.
 */
export const AbsoluteFilePathSchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes('\0'), 'must not contain null bytes')
  // `\\server\share…` — both components required, so a bare `\\` or `\\server`
  // (no share) stays rejected.
  .refine(
    (s) => s.startsWith('/') || /^[A-Za-z]:[/\\]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s),
    'must be an absolute filesystem path'
  )
  .brand<'AbsoluteFilePath'>()

export type AbsoluteFilePath = z.infer<typeof AbsoluteFilePathSchema>

/**
 * `CanonicalFilePath` — an `AbsoluteFilePath` additionally proven canonical — is defined
 * in `@shared/utils/file/canonicalize` (co-located with its schema and the
 * `canonicalizeFilePath()` factory, which is the only place that can build both
 * the value and its brand). It is not re-exported here.
 *
 * The subset is PROPER and not merely a spelling difference: the two brands
 * answer different questions (safe to hand to `fs` vs. safe to persist as a
 * dedup key), so a valid `AbsoluteFilePath` may have no `CanonicalFilePath`
 * counterpart at all. See that module's JSDoc for the full contract.
 */

// TODO: Add schema for them
export type Base64String = `data:${string};base64,${string}`
export type UrlString = `http://${string}` | `https://${string}`

export const Base64StringSchema: z.ZodType<Base64String> = z
  .string()
  .regex(/^data:[^;,]+;base64,.+$/) as z.ZodType<Base64String>

export const UrlStringSchema: z.ZodType<UrlString> = z
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://')) as z.ZodType<UrlString>

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
 * absolute `AbsoluteFilePath` (obtained from File IPC `getPhysicalPath` /
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
 * Use the raw `AbsoluteFilePath` from `getPhysicalPath` for those cases.
 */
export type FileUrlString = `file://${string}`

export type FileContent = AbsoluteFilePath | Base64String | UrlString | Uint8Array

// ─── File Version ───

/** Lightweight filesystem version used for optimistic concurrency control. */
export const FileVersionSchema = z.strictObject({
  mtime: z.number(),
  size: z.int().nonnegative()
})

export type FileVersion = z.infer<typeof FileVersionSchema>

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

/** A listed directory entry with its kind, so callers don't need a follow-up `isDirectory` per path. */
export interface DirectoryEntry {
  path: AbsoluteFilePath
  isDirectory: boolean
}
