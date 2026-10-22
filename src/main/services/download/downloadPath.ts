import { promises as fs } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'

export const DOWNLOAD_CONFLICT_POLICIES = ['uniquify', 'overwrite', 'fail'] as const
export type DownloadConflictPolicy = (typeof DOWNLOAD_CONFLICT_POLICIES)[number]

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const MAX_FILE_NAME = 120

/**
 * Strips path separators, control characters and Windows-forbidden characters,
 * collapses leading dots (so a download cannot become a hidden or `..` file) and
 * keeps the extension. The result is always a single path segment.
 */
export function sanitizeDownloadFileName(input: string, fallback = 'download'): string {
  const withoutSeparators = input.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim()
  const withoutLeadingDots = withoutSeparators.replace(/^\.+/, '')
  const candidate = (withoutLeadingDots || fallback).slice(0, MAX_FILE_NAME)
  return WINDOWS_RESERVED.test(candidate) ? `${candidate}_` : candidate
}

/** `report.pdf` + 2 → `report (2).pdf`. */
export function uniquifyFileName(fileName: string, attempt: number): string {
  if (attempt <= 0) return fileName
  const suffix = ` (${attempt})`
  const extension = extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  // Reserve room for the suffix before the length cap truncates it away.
  const safeExtension = extension.slice(0, Math.max(0, MAX_FILE_NAME - suffix.length - 1))
  const maxStem = Math.max(1, MAX_FILE_NAME - suffix.length - safeExtension.length)
  return `${stem.slice(0, maxStem)}${suffix}${safeExtension}`
}

/**
 * Picks a destination inside `dir`. `uniquify` probes the filesystem until a
 * free name is found; `overwrite` returns the path as-is; `fail` throws when the
 * name is taken.
 */
export async function resolveDownloadPath(
  dir: string,
  fileName: string,
  policy: DownloadConflictPolicy
): Promise<string> {
  const safeName = sanitizeDownloadFileName(fileName)
  const target = resolve(dir, safeName)
  if (!target.startsWith(resolve(dir) + sep)) throw new Error('download path escaped the download directory')

  if (policy === 'overwrite') return target
  const exists = await fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
  if (!exists) return target
  if (policy === 'fail') throw new Error(`file already exists: ${target}`)

  for (let attempt = 1; attempt < 10_000; attempt++) {
    const candidate = join(dir, uniquifyFileName(safeName, attempt))
    const taken = await fs
      .stat(candidate)
      .then(() => true)
      .catch(() => false)
    if (!taken) return candidate
  }
  throw new Error('could not find a free file name')
}

/** Best-effort name from a URL path; used when the server sends no filename. */
export function fileNameFromUrl(url: string, fallback = 'download'): string {
  try {
    const pathname = new URL(url).pathname
    const last = pathname.split('/').filter(Boolean).at(-1)
    return last ? decodeURIComponent(last) : fallback
  } catch {
    return fallback
  }
}
