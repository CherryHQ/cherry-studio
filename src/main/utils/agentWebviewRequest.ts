import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isSameOrInside, lstat, realpath } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { isAllowedHtmlArtifactRequest } from './htmlArtifactRequest'
import { sanitizeRemoteUrl } from './remoteUrlSafety'

interface WebviewRequestDetails {
  readonly resourceType: string
  readonly url: string
  readonly webContents?: { readonly id: number }
  readonly webContentsId?: number
}

const MAIN_FRAME = 'mainFrame'

export function isAllowedAgentDevPreviewEntryUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true
  const url = parseUrl(rawUrl)
  return Boolean(url && (url.protocol === 'http:' || url.protocol === 'https:') && getLoopbackOrigin(url))
}

export function isAllowedAgentHtmlArtifactEntryUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true
  const url = parseUrl(rawUrl)
  if (url?.protocol !== 'file:') return false

  try {
    return isHtmlPath(fileURLToPath(url))
  } catch {
    return false
  }
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
  private readonly rootByWebContentsId = new Map<number, Promise<AbsoluteFilePath | undefined>>()

  async isAllowed(details: WebviewRequestDetails): Promise<boolean> {
    if (details.url === 'about:blank') return true
    const webContentsId = getWebContentsId(details)
    if (webContentsId === undefined) return false

    const url = parseUrl(details.url)
    if (!url) return false

    if (details.resourceType === MAIN_FRAME) {
      if (url.protocol !== 'file:') return false
      const requestedPathPromise = getCanonicalHtmlFilePath(url)
      let authorizedRootPromise = this.rootByWebContentsId.get(webContentsId)
      if (!authorizedRootPromise) {
        authorizedRootPromise = requestedPathPromise.then((requestedPath) =>
          requestedPath ? AbsoluteFilePathSchema.parse(path.dirname(requestedPath)) : undefined
        )
        this.rootByWebContentsId.set(webContentsId, authorizedRootPromise)
      }

      const [requestedPath, authorizedRoot] = await Promise.all([requestedPathPromise, authorizedRootPromise])
      return Boolean(requestedPath && authorizedRoot && isSameOrInside(requestedPath, authorizedRoot))
    }

    const authorizedRootPromise = this.rootByWebContentsId.get(webContentsId)
    if (!authorizedRootPromise) return false
    const authorizedRoot = await authorizedRootPromise
    if (!authorizedRoot) return false

    if (url.protocol === 'file:') {
      const requestedPath = await getCanonicalFilePath(url)
      return requestedPath ? isSameOrInside(requestedPath, authorizedRoot) : false
    }

    return isAllowedHtmlArtifactRequest(details.url)
  }

  forget(webContentsId: number): void {
    this.rootByWebContentsId.delete(webContentsId)
  }

  clear(): void {
    this.rootByWebContentsId.clear()
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

async function getCanonicalFilePath(url: URL): Promise<AbsoluteFilePath | undefined> {
  try {
    return await realpath(AbsoluteFilePathSchema.parse(fileURLToPath(url)))
  } catch {
    return undefined
  }
}

async function getCanonicalHtmlFilePath(url: URL): Promise<AbsoluteFilePath | undefined> {
  const canonicalPath = await getCanonicalFilePath(url)
  if (!canonicalPath || !isHtmlPath(canonicalPath)) return undefined
  try {
    const metadata = await lstat(canonicalPath)
    return metadata.isFile ? canonicalPath : undefined
  } catch {
    return undefined
  }
}

function isHtmlPath(filePath: string): boolean {
  return ['.htm', '.html'].includes(path.extname(filePath).toLowerCase())
}
