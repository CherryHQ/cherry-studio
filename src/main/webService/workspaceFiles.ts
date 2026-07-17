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
const BT_ALLOWED_ROOT = 'D:/wwwroot/esaong.eu.org/bonsai'

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

const btPanelRootCandidates = [
  'C:/BtSoft',
  'D:/BtSoft',
  'C:/wwwroot',
  'D:/wwwroot',
  '/www/server',
  '/www/wwwroot',
  '/www/wwwlogs',
  '/www/backup',
  '/wwwroot'
] as const

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

export type WebUiWorkspaceFileAccessOptions = {
  readonly appRootPath?: string
  readonly executablePath?: string
  readonly homePath?: string
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

const normalizeDisplayPath = (value: string) => value.trim().replaceAll('\\', '/').replace(/\/+$/g, '')

const normalizeComparablePath = (value: string) => {
  const normalized = normalizeDisplayPath(path.resolve(value))
  return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

const isSameOrInsidePath = (rootPath: string, candidatePath: string) => {
  const root = normalizeComparablePath(rootPath)
  const candidate = normalizeComparablePath(candidatePath)
  return candidate === root || candidate.startsWith(`${root}/`)
}

const isPathInside = (rootPath: string, candidatePath: string) => {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const isAbsoluteRequestPath = (value: string) => path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)

const expandHomePath = (value: string, homePath?: string) => {
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  if (!homePath) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_INVALID_WORKSPACE_PATH', 'Home path is unavailable')
  }
  return path.join(homePath, value.slice(2))
}

const hasHiddenPathSegment = (value: string) =>
  normalizeDisplayPath(value)
    .replace(/^[A-Za-z]:/, '')
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'))

const getSystemBlockedRoots = async (options: WebUiWorkspaceFileAccessOptions) => {
  const roots = [
    process.env.SystemRoot,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.platform === 'win32' ? 'C:/Windows' : undefined,
    process.platform === 'win32' ? 'C:/Program Files' : undefined,
    process.platform === 'win32' ? 'C:/Program Files (x86)' : undefined,
    process.platform === 'win32' ? 'C:/ProgramData' : undefined,
    process.platform === 'darwin' ? '/System' : undefined,
    process.platform === 'darwin' ? '/Library' : undefined,
    process.platform === 'darwin' ? '/Applications' : undefined,
    process.platform !== 'win32' ? '/bin' : undefined,
    process.platform !== 'win32' ? '/boot' : undefined,
    process.platform !== 'win32' ? '/dev' : undefined,
    process.platform !== 'win32' ? '/etc' : undefined,
    process.platform !== 'win32' ? '/lib' : undefined,
    process.platform !== 'win32' ? '/lib64' : undefined,
    process.platform !== 'win32' ? '/proc' : undefined,
    process.platform !== 'win32' ? '/root' : undefined,
    process.platform !== 'win32' ? '/sbin' : undefined,
    process.platform !== 'win32' ? '/sys' : undefined,
    process.platform !== 'win32' ? '/usr' : undefined,
    process.platform !== 'win32' ? '/var' : undefined,
    options.appRootPath,
    options.executablePath ? path.dirname(options.executablePath) : undefined
  ].filter((root): root is string => Boolean(root?.trim()))

  return Promise.all(roots.map(async (root) => realpath(root).catch(() => root)))
}

const isBtPanelPathAllowed = (candidatePath: string) => isSameOrInsidePath(BT_ALLOWED_ROOT, candidatePath)

const isBtPanelPath = (candidatePath: string) =>
  btPanelRootCandidates.some((root) => isSameOrInsidePath(root, candidatePath))

const assertAllowedResolvedPath = async (resolvedPath: string, options: WebUiWorkspaceFileAccessOptions) => {
  if (hasHiddenPathSegment(resolvedPath)) {
    throw new WebUiWorkspaceFileError(403, 'WEBUI_WORKSPACE_PATH_BLOCKED', 'Hidden paths are not available in WebUI')
  }

  if (isBtPanelPath(resolvedPath) && !isBtPanelPathAllowed(resolvedPath)) {
    throw new WebUiWorkspaceFileError(403, 'WEBUI_WORKSPACE_PATH_BLOCKED', 'BT panel paths are not available in WebUI')
  }

  const blockedRoots = await getSystemBlockedRoots(options)
  if (blockedRoots.some((root) => isSameOrInsidePath(root, resolvedPath))) {
    throw new WebUiWorkspaceFileError(
      403,
      'WEBUI_WORKSPACE_PATH_BLOCKED',
      'System or application paths are not available in WebUI'
    )
  }
}

const assertRelativePath = (relativePath: string) => {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_INVALID_WORKSPACE_PATH', 'Workspace path must be relative')
  }
}

export async function resolveWebUiWorkspacePath(
  workspacePath: string,
  requestedPath: string,
  options: WebUiWorkspaceFileAccessOptions = {}
): Promise<{
  readonly workspaceRealPath: string
  readonly requestedRealPath: string
  readonly relativePath: string
  readonly scope: 'workspace' | 'external'
}> {
  const rawPath = requestedPath.trim()
  if (rawPath.includes('\0')) {
    throw new WebUiWorkspaceFileError(400, 'WEBUI_INVALID_WORKSPACE_PATH', 'Workspace path is invalid')
  }

  let workspaceRealPath: string
  try {
    workspaceRealPath = await realpath(workspacePath)
  } catch {
    throw new WebUiWorkspaceFileError(404, 'WEBUI_WORKSPACE_FILE_NOT_FOUND', 'Workspace file was not found')
  }

  const expandedPath = expandHomePath(rawPath, options.homePath)
  const absoluteRequest = isAbsoluteRequestPath(expandedPath)
  const relativePath = absoluteRequest ? '' : normalizeRelativePath(expandedPath)
  if (!absoluteRequest) assertRelativePath(expandedPath.replaceAll('\\', '/'))

  let requestedRealPath: string
  try {
    requestedRealPath = await realpath(absoluteRequest ? expandedPath : path.resolve(workspaceRealPath, relativePath))
  } catch {
    throw new WebUiWorkspaceFileError(404, 'WEBUI_WORKSPACE_FILE_NOT_FOUND', 'Workspace file was not found')
  }

  const insideWorkspace = isPathInside(workspaceRealPath, requestedRealPath)

  await assertAllowedResolvedPath(requestedRealPath, options)

  return {
    workspaceRealPath,
    requestedRealPath,
    relativePath: insideWorkspace
      ? path.relative(workspaceRealPath, requestedRealPath).split(path.sep).join('/')
      : normalizeDisplayPath(requestedRealPath),
    scope: insideWorkspace ? 'workspace' : 'external'
  }
}

const toSafeEntry = async (
  rootRealPath: string,
  entry: { path: string; isDirectory: boolean },
  scope: 'workspace' | 'external',
  options: WebUiWorkspaceFileAccessOptions
): Promise<WebUiWorkspaceFileEntry | undefined> => {
  const lexicalPath = path.resolve(entry.path)
  if (scope === 'workspace' && !isPathInside(rootRealPath, lexicalPath)) return undefined

  let resolvedPath: string
  try {
    resolvedPath = await realpath(lexicalPath)
  } catch {
    return undefined
  }
  if (scope === 'workspace' && !isPathInside(rootRealPath, resolvedPath)) return undefined

  try {
    await assertAllowedResolvedPath(resolvedPath, options)
  } catch {
    return undefined
  }

  const projectedPath =
    scope === 'workspace'
      ? path.relative(rootRealPath, lexicalPath).split(path.sep).join('/')
      : normalizeDisplayPath(resolvedPath)
  if (!projectedPath) return undefined
  return {
    path: projectedPath,
    name: path.basename(lexicalPath),
    isDirectory: entry.isDirectory
  }
}

export async function listWebUiWorkspaceFiles(
  workspacePath: string,
  requestedDirectory: string,
  search: string,
  options: WebUiWorkspaceFileAccessOptions = {}
): Promise<WebUiWorkspaceFilesResponse> {
  const normalizedSearch = search.trim().slice(0, 200)
  const target = await resolveWebUiWorkspacePath(workspacePath, requestedDirectory, options)
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
  const projectionRoot = target.scope === 'workspace' ? target.workspaceRealPath : target.requestedRealPath
  const projected = (
    await Promise.all(entries.map((entry) => toSafeEntry(projectionRoot, entry, target.scope, options)))
  ).filter((entry): entry is WebUiWorkspaceFileEntry => Boolean(entry))
  projected.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  return {
    workspaceName: path.basename(target.requestedRealPath) || target.requestedRealPath,
    directory: target.relativePath,
    entries: projected,
    search: normalizedSearch
  }
}

export async function readWebUiWorkspaceTextFile(
  workspacePath: string,
  requestedPath: string,
  options: WebUiWorkspaceFileAccessOptions = {}
): Promise<WebUiWorkspaceTextPreview> {
  const target = await resolveWebUiWorkspacePath(workspacePath, requestedPath, options)
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
  requestedPath: string,
  options: WebUiWorkspaceFileAccessOptions = {}
): Promise<WebUiWorkspaceBinaryPreview> {
  const target = await resolveWebUiWorkspacePath(workspacePath, requestedPath, options)
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
