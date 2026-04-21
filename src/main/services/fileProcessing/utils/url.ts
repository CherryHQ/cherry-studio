import * as ipaddr from 'ipaddr.js'

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.'])
const BLOCKED_IPV4_RANGES = new Set([
  'broadcast',
  'carrierGradeNat',
  'linkLocal',
  'loopback',
  'multicast',
  'private',
  'reserved',
  'unspecified'
])
const BLOCKED_IPV6_RANGES = new Set(['linkLocal', 'loopback', 'multicast', 'uniqueLocal', 'unspecified'])

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1).toLowerCase()
  }

  return hostname.toLowerCase()
}

function parseIpHostname(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  const normalized = normalizeHostname(hostname)

  if (!ipaddr.isValid(normalized)) {
    return undefined
  }

  return ipaddr.process(normalized)
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()

  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost') || normalized.endsWith('.localhost.')
}

function isBlockedIpHostname(hostname: string): boolean {
  const address = parseIpHostname(hostname)

  if (!address) {
    return false
  }

  if (address.kind() === 'ipv4') {
    return BLOCKED_IPV4_RANGES.has(address.range())
  }

  return BLOCKED_IPV6_RANGES.has(address.range())
}

function isLoopbackHostname(hostname: string): boolean {
  if (isLocalHostname(hostname)) {
    return true
  }

  const address = parseIpHostname(hostname)
  return Boolean(address && address.range() === 'loopback')
}

function getEffectivePort(url: URL): string {
  if (url.port) {
    return url.port
  }

  switch (url.protocol) {
    case 'http:':
      return '80'
    case 'https:':
      return '443'
    default:
      return ''
  }
}

function isBlockedHostname(hostname: string): boolean {
  return isLocalHostname(hostname) || isBlockedIpHostname(hostname)
}

function hasMatchingConfiguredOrigin(url: URL, configuredApiHost: string): boolean {
  let configuredUrl: URL
  try {
    configuredUrl = new URL(configuredApiHost)
  } catch {
    return false
  }

  if (
    (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') ||
    configuredUrl.username ||
    configuredUrl.password ||
    url.protocol !== configuredUrl.protocol ||
    getEffectivePort(url) !== getEffectivePort(configuredUrl)
  ) {
    return false
  }

  const normalizedHostname = normalizeHostname(url.hostname)
  const normalizedConfiguredHostname = normalizeHostname(configuredUrl.hostname)

  return (
    normalizedHostname === normalizedConfiguredHostname ||
    (isLoopbackHostname(url.hostname) && isLoopbackHostname(configuredUrl.hostname))
  )
}

export function sanitizeFileProcessingRemoteUrl(rawUrl: string, configuredApiHost?: string): string {
  const parsedUrl = parseRemoteUrl(rawUrl)

  const allowMatchingConfiguredOrigin =
    configuredApiHost !== undefined && hasMatchingConfiguredOrigin(parsedUrl, configuredApiHost)

  if (isBlockedHostname(parsedUrl.hostname) && !allowMatchingConfiguredOrigin) {
    throw new Error(`Unsafe remote url: local or private addresses are not allowed (${parsedUrl.hostname})`)
  }

  return parsedUrl.toString()
}

function parseRemoteUrl(rawUrl: string): URL {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid remote url: ${rawUrl}`)
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid remote url: ${rawUrl}`)
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Unsafe remote url: credentials are not allowed')
  }

  return parsedUrl
}
