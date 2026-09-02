import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath, createFilePathHandle, fileUrlToPath } from '@shared/utils/file'

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

export function getFilePreviewRefreshKey(metadata: Record<string, unknown> | undefined): number {
  const value = metadata?.[FILE_PREVIEW_REFRESH_KEY]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function normalizeFilePreviewPath(filePath: string): AbsoluteFilePath {
  const canonicalPath = canonicalizeFilePath(filePath)
  return createFilePathHandle(canonicalPath).path
}

export function parseFilePreviewUrlPath(url: string): AbsoluteFilePath | undefined {
  try {
    const path = AbsoluteFilePathSchema.safeParse(fileUrlToPath(new URL(url)))
    return path.success ? path.data : undefined
  } catch {
    return undefined
  }
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
