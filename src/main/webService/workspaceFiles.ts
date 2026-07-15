import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { listDirectoryEntries } from '@main/services/file'
import { readTextFileWithAutoEncoding } from '@main/utils/legacyFile'
import type { FilePath } from '@shared/types/file'
import { isBinaryFile } from 'isbinaryfile'

const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_PREVIEW_BYTES = 25 * 1024 * 1024
const MAX_SEARCH_ENTRIES = 200

const previewContentTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export class WebUiWorkspaceFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WebUiWorkspaceFileError'
  }
}

export type WebUiWorkspaceFileEntry = {
  readonly path: string
  readonly name: string
  readonly isDirectory: boolean
}

export type WebUiWorkspaceFilesResponse = {
  readonly workspaceName: string
  readonly directory: string
  readonly entries: readonly WebUiWorkspaceFileEntry[]
  readonly search: string
}

export type WebUiWorkspaceTextPreview = {
  readonly kind: 'text' | 'binary'
  readonly path: string
  readonly name: string
  readonly size: number
  readonly content?: string
}

export type WebUiWorkspaceBinaryPreview = {
  readonly bytes: Buffer
  readonly contentType: string
  readonly name: string
}

const normalizeRelativePath = (value: string) =>
  value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')

const isPathInside = (rootPath: string, candidatePath: string) => {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const assertRelativePath = (relativePath: string) => {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_INVALID_WORKSPACE_PATH', 'Workspace path must be relative')
  }
  if (relativePath.split('/').some((segment) => segment === '..')) {
    throw new WebUiWorkspaceFileError(403, 'WEBUI_WORKSPACE_PATH_BLOCKED', 'Workspace path traversal is not allowed')
  }
}

export async function resolveWebUiWorkspacePath(
  workspacePath: string,
  requestedPath: string
): Promise<{
  readonly workspaceRealPath: string
  readonly requestedRealPath: string
  readonly relativePath: string
}> {
  const rawPath = requestedPath.trim().replaceAll('\\', '/')
  assertRelativePath(rawPath)
  const relativePath = normalizeRelativePath(rawPath)

  let workspaceRealPath: string
  let requestedRealPath: string
  try {
    workspaceRealPath = await realpath(workspacePath)
    requestedRealPath = await realpath(path.resolve(workspaceRealPath, relativePath))
  } catch {
    throw new WebUiWorkspaceFileError(404, 'WEBUI_WORKSPACE_FILE_NOT_FOUND', 'Workspace file was not found')
  }

  if (!isPathInside(workspaceRealPath, requestedRealPath)) {
    throw new WebUiWorkspaceFileError(
      403,
      'WEBUI_WORKSPACE_PATH_BLOCKED',
      'Workspace path leaves the session workspace'
    )
  }

  return { workspaceRealPath, requestedRealPath, relativePath }
}

const toSafeEntry = async (
  workspaceRealPath: string,
  entry: { path: string; isDirectory: boolean }
): Promise<WebUiWorkspaceFileEntry | undefined> => {
  const lexicalPath = path.resolve(entry.path)
  if (!isPathInside(workspaceRealPath, lexicalPath)) return undefined

  let resolvedPath: string
  try {
    resolvedPath = await realpath(lexicalPath)
  } catch {
    return undefined
  }
  if (!isPathInside(workspaceRealPath, resolvedPath)) return undefined

  const relativePath = path.relative(workspaceRealPath, lexicalPath).split(path.sep).join('/')
  if (!relativePath) return undefined
  return {
    path: relativePath,
    name: path.basename(lexicalPath),
    isDirectory: entry.isDirectory
  }
}

export async function listWebUiWorkspaceFiles(
  workspacePath: string,
  requestedDirectory: string,
  search: string
): Promise<WebUiWorkspaceFilesResponse> {
  const normalizedSearch = search.trim().slice(0, 200)
  const target = await resolveWebUiWorkspacePath(workspacePath, normalizedSearch ? '' : requestedDirectory)
  const targetStat = await stat(target.requestedRealPath)
  if (!targetStat.isDirectory()) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_WORKSPACE_NOT_DIRECTORY', 'Workspace path is not a directory')
  }

  const entries = await listDirectoryEntries(target.requestedRealPath as FilePath, {
    includeHidden: false,
    includeFiles: true,
    includeDirectories: true,
    ...(normalizedSearch
      ? { recursive: true, maxDepth: 0, maxEntries: MAX_SEARCH_ENTRIES, searchPattern: normalizedSearch }
      : { recursive: false, maxDepth: 1 })
  })
  const projected = (await Promise.all(entries.map((entry) => toSafeEntry(target.workspaceRealPath, entry)))).filter(
    (entry): entry is WebUiWorkspaceFileEntry => Boolean(entry)
  )
  projected.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  return {
    workspaceName: path.basename(target.workspaceRealPath) || target.workspaceRealPath,
    directory: normalizeRelativePath(requestedDirectory),
    entries: projected,
    search: normalizedSearch
  }
}

export async function readWebUiWorkspaceTextFile(
  workspacePath: string,
  requestedPath: string
): Promise<WebUiWorkspaceTextPreview> {
  const target = await resolveWebUiWorkspacePath(workspacePath, requestedPath)
  const fileStat = await stat(target.requestedRealPath)
  if (!fileStat.isFile()) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_WORKSPACE_NOT_FILE', 'Workspace path is not a file')
  }
  if (fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
    throw new WebUiWorkspaceFileError(413, 'WEBUI_WORKSPACE_FILE_TOO_LARGE', 'Text preview is limited to 2 MB')
  }

  const isBinary = await isBinaryFile(target.requestedRealPath)
  return {
    kind: isBinary ? 'binary' : 'text',
    path: target.relativePath,
    name: path.basename(target.requestedRealPath),
    size: fileStat.size,
    ...(isBinary ? {} : { content: await readTextFileWithAutoEncoding(target.requestedRealPath) })
  }
}

export async function readWebUiWorkspaceBinaryPreview(
  workspacePath: string,
  requestedPath: string
): Promise<WebUiWorkspaceBinaryPreview> {
  const target = await resolveWebUiWorkspacePath(workspacePath, requestedPath)
  const fileStat = await stat(target.requestedRealPath)
  const contentType = previewContentTypes[path.extname(target.requestedRealPath).toLowerCase()]
  if (!fileStat.isFile() || !contentType) {
    throw new WebUiWorkspaceFileError(
      415,
      'WEBUI_WORKSPACE_PREVIEW_UNSUPPORTED',
      'Workspace file is not a supported preview format'
    )
  }
  const maxPreviewBytes = contentType.startsWith('image/') ? MAX_IMAGE_PREVIEW_BYTES : MAX_DOCUMENT_PREVIEW_BYTES
  if (fileStat.size > maxPreviewBytes) {
    throw new WebUiWorkspaceFileError(
      413,
      'WEBUI_WORKSPACE_FILE_TOO_LARGE',
      `Preview is limited to ${maxPreviewBytes / 1024 / 1024} MB`
    )
  }

  return {
    bytes: await readFile(target.requestedRealPath),
    contentType,
    name: path.basename(target.requestedRealPath)
  }
}
