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
export type URLString = `http://${string}` | `https://${string}`

/**
 * `file://` URL pointing at a local resource.
 *
 * Runtime validation required — the template-literal pattern only provides a
 * type-level hint. Produced by the shared pure helper
 * `toSafeFileUrl(path, ext)` (in `@shared/file/urlUtil`), which composes an
 * absolute `FilePath` (obtained from File IPC `getPhysicalPath` /
 * `batchGetPhysicalPaths`) with a danger-file safety wrap (for
 * `.sh` / `.bat` / `.ps1` / `.exe` / `.app` etc., the URL points at the
 * containing directory instead of the file).
 *
 * Keep this distinct from `URLString` (http/https) so signatures can refuse
 * the wrong family.
 *
 * The safety wrap is scoped to HTML rendering contexts (`<img src>` /
 * `<video src>` / `<embed>`); it is **not** a general-purpose path-safety
 * primitive — don't compose this value into shell commands or subprocess args.
 * Use the raw `FilePath` from `getPhysicalPath` for those cases.
 */
export type FileURLString = `file://${string}`

export type FileContent = FilePath | Base64String | URLString | Uint8Array

// ─── Physical File Metadata ───

type MetadataBase = { size: number; createdAt: number; modifiedAt: number }

type DirectoryMetadata = MetadataBase & { kind: 'directory' }

type FileMetadataCommon = MetadataBase & { kind: 'file'; mime: string }
type ImageFileMetadata = FileMetadataCommon & { type: 'image'; width: number; height: number }
type PdfFileMetadata = FileMetadataCommon & { type: 'pdf'; pageCount: number }
type TextFileMetadata = FileMetadataCommon & { type: 'text'; encoding: string }
type GenericFileMetadata = FileMetadataCommon & { type: 'other' }

type FileKindMetadata = ImageFileMetadata | PdfFileMetadata | TextFileMetadata | GenericFileMetadata
/** Physical file metadata (size, timestamps, and type-specific info like dimensions/pageCount). Discriminate on `kind`, then `type`. */
export type PhysicalFileMetadata = DirectoryMetadata | FileKindMetadata

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
