import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lstat, realpath } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { sanitizeRemoteUrl } from './remoteUrlSafety'

interface WebviewRequestDetails {
  readonly resourceType: string
  readonly url: string
  readonly webContents?: { readonly id: number }
  readonly webContentsId?: number
}

const MAIN_FRAME = 'mainFrame'

interface AuthorizedArtifactRoot {
  readonly lexical: AbsoluteFilePath
  readonly canonical: AbsoluteFilePath
}

export function isAllowedAgentDevPreviewEntryUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true
  const url = parseUrl(rawUrl)
  return Boolean(url && (url.protocol === 'http:' || url.protocol === 'https:') && getLoopbackOrigin(url))
}

export function isAllowedAgentHtmlArtifactEntryUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true
  const filePath = parseLocalArtifactFileUrl(rawUrl)
  return Boolean(filePath && isHtmlPath(filePath))
}

export class AgentDevPreviewRequestPolicy {
  private readonly originByWebContentsId = new Map<number, string>()

  async isAllowed(details: WebviewRequestDetails): Promise<boolean> {
    if (details.url === 'about:blank') return true
    const webContentsId = getWebContentsId(details)
    if (webContentsId === undefined) return false

    const url = parseUrl(details.url)
    if (!url) return false

    if (details.resourceType === MAIN_FRAME) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      const requestedOrigin = getLoopbackOrigin(url)
      if (!requestedOrigin) return false

      const authorizedOrigin = this.originByWebContentsId.get(webContentsId)
      if (authorizedOrigin) return requestedOrigin === authorizedOrigin

      this.originByWebContentsId.set(webContentsId, requestedOrigin)
      return true
    }

    const authorizedOrigin = this.originByWebContentsId.get(webContentsId)
    if (!authorizedOrigin) return false

    const loopbackOrigin = getLoopbackOrigin(url)
    if (loopbackOrigin) return loopbackOrigin === authorizedOrigin
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true

    return isAllowedPublicSecureRequest(url)
  }

  forget(webContentsId: number): void {
    this.originByWebContentsId.delete(webContentsId)
  }

  clear(): void {
    this.originByWebContentsId.clear()
  }
}

/**
 * File access granted only after a user explicitly opens an Agent artifact.
 * The generic HTML artifact profile remains data-only and never uses this policy.
 */
export class AgentHtmlArtifactRequestPolicy {
  private readonly rootByWebContentsId = new Map<number, Promise<AuthorizedArtifactRoot | undefined>>()

  async isAllowed(details: WebviewRequestDetails): Promise<boolean> {
    if (details.url === 'about:blank') return true
    const webContentsId = getWebContentsId(details)
    if (webContentsId === undefined) return false

    const url = parseUrl(details.url)
    if (!url) return false

    if (details.resourceType === MAIN_FRAME) {
      if (url.protocol !== 'file:') return false
      let authorizedRootPromise = this.rootByWebContentsId.get(webContentsId)
      if (!authorizedRootPromise) {
        authorizedRootPromise = authorizeInitialArtifactRoot(url)
        this.rootByWebContentsId.set(webContentsId, authorizedRootPromise)
        return Boolean(await authorizedRootPromise)
      }

      const authorizedRoot = await authorizedRootPromise
      return authorizedRoot ? isAllowedArtifactFile(url, authorizedRoot, true) : false
    }

    const authorizedRootPromise = this.rootByWebContentsId.get(webContentsId)
    if (!authorizedRootPromise) return false
    const authorizedRoot = await authorizedRootPromise
    if (!authorizedRoot) return false

    if (url.protocol === 'file:') {
      return isAllowedArtifactFile(url, authorizedRoot, false)
    }

    return url.protocol === 'data:' || url.protocol === 'blob:'
  }

  forget(webContentsId: number): void {
    this.rootByWebContentsId.delete(webContentsId)
  }

  clear(): void {
    this.rootByWebContentsId.clear()
  }
}

export function isCanonicalPathInside(candidate: string, root: string): boolean {
  if (candidate === root) return true
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return candidate.startsWith(rootWithSeparator)
}

export function parseLocalArtifactFileUrl(rawUrl: string | URL): AbsoluteFilePath | undefined {
  const url = typeof rawUrl === 'string' ? parseUrl(rawUrl) : rawUrl
  if (
    !url ||
    url.protocol !== 'file:' ||
    url.hostname ||
    url.username ||
    url.password ||
    url.pathname.startsWith('//')
  ) {
    return undefined
  }

  try {
    const filePath = fileURLToPath(url)
    if (filePath.startsWith('//') || filePath.startsWith('\\\\')) return undefined
    return AbsoluteFilePathSchema.parse(path.normalize(filePath))
  } catch {
    return undefined
  }
}

function getWebContentsId(details: WebviewRequestDetails): number | undefined {
  const webContentsId = details.webContentsId ?? details.webContents?.id
  return typeof webContentsId === 'number' && webContentsId > 0 ? webContentsId : undefined
}

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

function getLoopbackOrigin(url: URL): string | undefined {
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return undefined
  if (url.username || url.password) return undefined

  const hostname = url.hostname.toLowerCase()
  if (
    hostname !== 'localhost' &&
    hostname !== '0.0.0.0' &&
    hostname !== '[::1]' &&
    !/^127(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    return undefined
  }

  const canonicalUrl = new URL(url)
  if (canonicalUrl.protocol === 'ws:') canonicalUrl.protocol = 'http:'
  if (canonicalUrl.protocol === 'wss:') canonicalUrl.protocol = 'https:'
  if (hostname === '0.0.0.0') canonicalUrl.hostname = 'localhost'
  return canonicalUrl.origin
}

function isAllowedPublicSecureRequest(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return false

  try {
    const remoteUrl = new URL(url)
    if (remoteUrl.protocol === 'wss:') remoteUrl.protocol = 'https:'
    sanitizeRemoteUrl(remoteUrl.toString())
    return true
  } catch {
    return false
  }
}

async function authorizeInitialArtifactRoot(url: URL): Promise<AuthorizedArtifactRoot | undefined> {
  const lexicalPath = parseLocalArtifactFileUrl(url)
  if (!lexicalPath || !isHtmlPath(lexicalPath)) return undefined

  const lexicalRoot = AbsoluteFilePathSchema.parse(path.dirname(lexicalPath))
  try {
    const rootMetadata = await lstat(lexicalRoot)
    if (!rootMetadata.isDirectory || rootMetadata.isSymbolicLink) return undefined

    const fileMetadata = await lstat(lexicalPath)
    if (!fileMetadata.isFile || fileMetadata.isSymbolicLink) return undefined

    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(lexicalRoot), realpath(lexicalPath)])
    if (!isCanonicalPathInside(canonicalPath, canonicalRoot)) return undefined
    return { lexical: lexicalRoot, canonical: canonicalRoot }
  } catch {
    return undefined
  }
}

async function isAllowedArtifactFile(
  url: URL,
  authorizedRoot: AuthorizedArtifactRoot,
  requireHtml: boolean
): Promise<boolean> {
  const lexicalPath = parseLocalArtifactFileUrl(url)
  if (
    !lexicalPath ||
    (requireHtml && !isHtmlPath(lexicalPath)) ||
    !isCanonicalPathInside(lexicalPath, authorizedRoot.lexical)
  ) {
    return false
  }

  try {
    const rootMetadata = await lstat(authorizedRoot.lexical)
    if (!rootMetadata.isDirectory || rootMetadata.isSymbolicLink) return false

    let currentPath = authorizedRoot.lexical
    let currentMetadata = rootMetadata
    const rootWithSeparator = authorizedRoot.lexical.endsWith(path.sep)
      ? authorizedRoot.lexical
      : `${authorizedRoot.lexical}${path.sep}`
    const pathSegments =
      lexicalPath === authorizedRoot.lexical ? [] : lexicalPath.slice(rootWithSeparator.length).split(path.sep)

    for (const segment of pathSegments) {
      currentPath = AbsoluteFilePathSchema.parse(path.join(currentPath, segment))
      currentMetadata = await lstat(currentPath)
      if (currentMetadata.isSymbolicLink) return false
      if (currentPath !== lexicalPath && !currentMetadata.isDirectory) return false
    }

    if (requireHtml && !currentMetadata.isFile) return false
    const canonicalPath = await realpath(lexicalPath)
    return isCanonicalPathInside(canonicalPath, authorizedRoot.canonical)
  } catch {
    return false
  }
}

function isHtmlPath(filePath: string): boolean {
  return ['.htm', '.html'].includes(path.extname(filePath).toLowerCase())
}
