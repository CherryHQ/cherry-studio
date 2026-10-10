import { sanitizeRemoteUrl } from './remoteUrlSafety'

export function isAllowedHtmlArtifactRequest(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true

    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:'
    }

    sanitizeRemoteUrl(url.toString())
    return true
  } catch {
    return false
  }
}
