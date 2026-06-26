import type { DanglingState, FileEntryOrigin } from '@shared/data/types/file'
import type { FileType } from '@shared/types/file'
import { File, FileCode, FileText, Image as ImageIcon, Music, Video } from 'lucide-react'
import type { FC } from 'react'

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
    py: 'Python',
    ts: 'TypeScript',
    tsx: 'TSX',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    mp3: 'MP3',
    mp4: 'MP4',
    md: 'Markdown',
    txt: 'Text',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PPT',
    pptx: 'PPT',
    bin: 'Binary'
  }
  return map[format] || format.toUpperCase()
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export const typeIcons: Record<FileType, FC<{ size?: number; strokeWidth?: number; className?: string }>> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileCode,
  document: FileText,
  other: File
}

export const typeIconColors: Record<FileType, string> = {
  image: 'text-pink-500/50',
  video: 'text-violet-500/50',
  audio: 'text-amber-500/50',
  text: 'text-cyan-500/50',
  document: 'text-blue-500/50',
  other: 'text-muted-foreground/40'
}

export const typeBgColors: Record<FileType, string> = {
  image: 'bg-pink-500/[0.04]',
  video: 'bg-violet-500/[0.04]',
  audio: 'bg-amber-500/[0.04]',
  text: 'bg-cyan-500/[0.04]',
  document: 'bg-blue-500/[0.04]',
  other: 'bg-muted/20'
}
