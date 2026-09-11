import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath, createFilePathHandle, parseWindowsPath } from '@shared/utils/file'

export const FILE_PREVIEW_ROUTE = '/app/file-preview'
export const FILE_PREVIEW_REFRESH_KEY = 'filePreviewRefreshKey'

export interface FilePreviewRouteSearch {
  path: AbsoluteFilePath | undefined
}

export interface FilePreviewTabTarget {
  filePath: AbsoluteFilePath
  title: string
  url: string
}

function normalizeUncFilePreviewPath(filePath: string): AbsoluteFilePath {
  const nativePath = filePath.startsWith('//') ? `\\\\${filePath.slice(2)}` : filePath
  const parsed = parseWindowsPath(nativePath)
  if (!parsed.isAbsolute || !parsed.root.startsWith('\\\\')) throw new Error('Invalid UNC file preview path')

  const segments: string[] = []
  for (const segment of parsed.segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  const suffix = segments.length > 0 ? `\\${segments.join('\\')}` : ''
  return AbsoluteFilePathSchema.parse(`${parsed.root.replace(/\//g, '\\')}${suffix}`)
}

export function getFilePreviewRefreshKey(metadata: Record<string, unknown> | undefined): number {
  const value = metadata?.[FILE_PREVIEW_REFRESH_KEY]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function normalizeFilePreviewPath(filePath: string): AbsoluteFilePath {
  if (filePath.startsWith('\\\\') || filePath.startsWith('//')) return normalizeUncFilePreviewPath(filePath)
  const canonicalPath = canonicalizeFilePath(filePath)
  return createFilePathHandle(canonicalPath).path
}

export function getFilePreviewFileName(filePath: string): string {
  const segments = filePath.split(/[/\\]/).filter(Boolean)
  return segments.at(-1) ?? filePath
}

export function getFilePreviewExtension(filePath: string): string | null {
  const fileName = getFilePreviewFileName(filePath)
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return null
  return fileName.slice(dotIndex + 1).toLowerCase()
}

export function createFilePreviewTabTarget(filePath: string): FilePreviewTabTarget {
  const normalizedPath = normalizeFilePreviewPath(filePath)
  const search = new URLSearchParams({ path: normalizedPath })

  return {
    filePath: normalizedPath,
    title: getFilePreviewFileName(normalizedPath),
    url: `${FILE_PREVIEW_ROUTE}?${search.toString()}`
  }
}

export function parseFilePreviewRouteSearch(search: Record<string, unknown>): FilePreviewRouteSearch {
  if (typeof search.path !== 'string') return { path: undefined }

  try {
    return { path: normalizeFilePreviewPath(search.path) }
  } catch {
    return { path: undefined }
  }
}
