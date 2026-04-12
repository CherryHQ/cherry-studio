import { isIP } from 'node:net'

import { sanitizeUrl } from 'strict-url-sanitise'

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.'])

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts

  if (a === 0 || a === 10 || a === 127) {
    return true
  }

  if (a === 100 && b >= 64 && b <= 127) {
    return true
  }

  if (a === 169 && b === 254) {
    return true
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }

  if (a === 192 && b === 168) {
    return true
  }

  if (a === 198 && (b === 18 || b === 19)) {
    return true
  }

  if (a >= 224) {
    return true
  }

  return false
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()

  if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true
  }

  if (normalized.startsWith('::ffff:')) {
    return isPrivateHostname(normalized.slice('::ffff:'.length))
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }

  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true
  }

  return false
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  const ipVersion = isIP(normalized)

  if (ipVersion === 4) {
    return isPrivateIpv4(normalized)
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(normalized)
  }

  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost') || normalized.endsWith('.localhost.')
}

export function sanitizeFileProcessingRemoteUrl(rawUrl: string): string {
  let sanitizedUrl: string
  try {
    sanitizedUrl = sanitizeUrl(rawUrl)
  } catch {
    throw new Error(`Invalid remote url: ${rawUrl}`)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(sanitizedUrl)
  } catch {
    throw new Error(`Invalid remote url: ${rawUrl}`)
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid remote url: ${rawUrl}`)
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Unsafe remote url: credentials are not allowed')
  }

  if (isPrivateHostname(parsedUrl.hostname)) {
    throw new Error(`Unsafe remote url: local or private addresses are not allowed (${parsedUrl.hostname})`)
  }

  return sanitizedUrl
}
