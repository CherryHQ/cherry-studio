import type { DanglingState, FileEntryOrigin } from '@shared/data/types/file'
import type { FileType } from '@shared/types/file'

type FileItemCore = {
  id: string
  name: string
  format: string
  size: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
  trashed: boolean
  danglingState?: DanglingState
  isMissing?: boolean
  /** Filesystem or external path used to distinguish same-name rows. Not a preview URL. */
  sourcePath?: string
}

type InternalFileItemFields = {
  origin: Extract<FileEntryOrigin, 'internal'>
}

type ExternalFileItemFields = {
  origin: Extract<FileEntryOrigin, 'external'>
}

type FileItemOriginFields = InternalFileItemFields | ExternalFileItemFields

export type ImageFileItem = FileItemCore &
  FileItemOriginFields & {
    type: Extract<FileType, 'image'>
    previewUrl?: string
  }

export type NonImageFileItem = FileItemCore &
  FileItemOriginFields & {
    type: Exclude<FileType, 'image'>
  }

export type FileItem = ImageFileItem | NonImageFileItem

export function getFormatLabel(format: string): string {
  if (!format) return '—'

  const map: Record<string, string> = {
    png: 'PNG',
    jpg: 'JPG',
    jpeg: 'JPEG',
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    odt: 'ODT',
    rtf: 'RTF',
    epub: 'EPUB',
    py: 'Python',
    ts: 'TypeScript',
    tsx: 'TSX',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    mp3: 'MP3',
    mp4: 'MP4',
    md: 'Markdown',
    markdown: 'Markdown',
    mdx: 'Markdown',
    txt: 'Text',
    text: 'Text',
    xls: 'Excel',
    xlsx: 'Excel',
    ods: 'Excel',
    csv: 'CSV',
    tsv: 'TSV',
    ppt: 'PPT',
    pptx: 'PPT',
    odp: 'PPT',
    bin: 'Binary'
  }
  return map[format] || format.toUpperCase()
}

export function getFileIconPath(file: { name: string; format: string }): string {
  const name = file.name ?? ''
  const format = (file.format ?? '').trim().replace(/^\./, '')
  if (!format) return name
  return name.toLowerCase().endsWith(`.${format.toLowerCase()}`) ? name : `${name}.${format}`
}

export const typeIconColors: Record<FileType, string> = {
  image: 'text-muted-foreground',
  video: 'text-muted-foreground',
  audio: 'text-muted-foreground',
  text: 'text-muted-foreground',
  document: 'text-muted-foreground',
  other: 'text-muted-foreground'
}

export const typeBgColors: Record<FileType, string> = {
  image: 'bg-muted',
  video: 'bg-muted',
  audio: 'bg-muted',
  text: 'bg-muted',
  document: 'bg-muted',
  other: 'bg-muted'
}
