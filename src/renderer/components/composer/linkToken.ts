import { createComposerSecureRandomId } from '@renderer/utils/message/composerFileTokenSource'

import type { ComposerDraftToken } from './tokens'

export interface ComposerLink {
  url: string
  hostname: string
  label: string
}

export function parseComposerLink(value: string | undefined): ComposerLink | null {
  const url = value?.trim()
  if (!url || /\s/.test(url)) return null

  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    const hostname = parsed.hostname.replace(/^www\./, '')
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')

    return {
      url,
      hostname: parsed.hostname,
      label: `${hostname}${pathname}`
    }
  } catch {
    return null
  }
}

export function createComposerLinkToken(value: string): ComposerDraftToken | null {
  const link = parseComposerLink(value)
  if (!link) return null

  return {
    id: createComposerSecureRandomId('link-token'),
    kind: 'link',
    label: link.label,
    promptText: link.url
  }
}
