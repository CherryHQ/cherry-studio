export interface SafeExternalUrl {
  readonly url: string
  readonly protocol: string
  readonly requiresConfirmation: boolean
}

const EXTERNAL_URL_POLICY = Object.freeze({
  http: false,
  https: false,
  mailto: false,
  obsidian: true,
  zotero: true,
  siyuan: true,
  vscode: true,
  'vscode-insiders': true,
  cursor: true,
  zed: true
})

/** Scheme spellings without ':' — derived from the policy table, frozen. */
export const EXTERNAL_LINK_PROTOCOLS: readonly string[] = Object.freeze(Object.keys(EXTERNAL_URL_POLICY))

const ZED_FILE_URL_RE = /^zed:\/\/file(\/|[A-Za-z]%3[Aa]\/)/i

function isFileOpenEditorUrl(parsed: URL, rawUrl: string): boolean {
  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.protocol === 'zed:') return ZED_FILE_URL_RE.test(rawUrl)
  return parsed.host === 'file'
}

function isKnowledgeUrl(parsed: URL, rawUrl: string): boolean {
  // oxlint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f\\]/.test(rawUrl) || /%(?![\da-f]{2})/i.test(rawUrl)) return false
  const authority = /^[a-z]+:\/\/([^/?#]+)/i.exec(rawUrl)?.[1]
  if (!authority || authority !== parsed.host || parsed.username || parsed.password || parsed.port) return false
  if (parsed.protocol === 'obsidian:') {
    return (authority === 'open' || authority === 'new') && parsed.pathname === ''
  }

  const segments = parsed.pathname.slice(1).split('/')
  if (!parsed.pathname.startsWith('/')) return false
  for (const segment of segments) {
    const decoded = decodeURIComponent(segment)
    // oxlint-disable-next-line no-control-regex
    if (!decoded || /[/\\?#\x00-\x1f\x7f]/.test(decoded)) return false
  }
  if (parsed.protocol === 'siyuan:') return authority === 'blocks' && segments.length === 1

  // Match structural literals before decoding so encoded action/path spellings cannot alias them.
  const path = parsed.pathname
  if (authority === 'open-pdf') {
    return /^\/(?:library\/items\/[^/]+|groups\/\d+\/items\/[^/]+|\d+_[^/]+\/\d+)$/.test(path)
  }
  if (authority === 'select') {
    return /^\/(?:(?:library|groups\/\d+)\/(?:items|collections|searches)\/[^/]+|(?:library|groups\/\d+)\/(?:collections|searches)\/[^/]+\/items\/[^/]+|items\/[^/]+)$/.test(
      path
    )
  }
  return false
}

export function resolveSafeExternalUrl(input: string): SafeExternalUrl | null {
  try {
    const parsed = new URL(input)
    const scheme = parsed.protocol.slice(0, -1)
    if (!Object.hasOwn(EXTERNAL_URL_POLICY, scheme)) return null
    const requiresConfirmation = EXTERNAL_URL_POLICY[scheme as keyof typeof EXTERNAL_URL_POLICY]
    const isKnowledge = scheme === 'obsidian' || scheme === 'zotero' || scheme === 'siyuan'
    if (isKnowledge) {
      if (!isKnowledgeUrl(parsed, input)) return null
    } else if (requiresConfirmation && !isFileOpenEditorUrl(parsed, input)) {
      return null
    }
    return { url: isKnowledge ? parsed.href : input, protocol: parsed.protocol, requiresConfirmation }
  } catch {
    return null
  }
}

export function isSafeExternalUrl(input: string): boolean {
  return resolveSafeExternalUrl(input) !== null
}
