import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'

import * as ipaddr from 'ipaddr.js'

export type RemoteFetchAddress = {
  readonly address: string
  readonly family: 4 | 6
}

export type ResolvedRemoteFetchUrl = {
  readonly url: string
  readonly address: RemoteFetchAddress
}

export type ResolveRemoteFetchUrlOptions = {
  readonly signal?: AbortSignal
}

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
const BLOCKED_IPV6_RANGES = new Set([
  '6to4',
  'benchmarking',
  'discard',
  'linkLocal',
  'loopback',
  'multicast',
  'reserved',
  'rfc6052',
  'rfc6145',
  'teredo',
  'uniqueLocal',
  'unspecified'
])
const BLOCKED_IPV6_CIDR_RANGES: ReadonlyArray<readonly [ipaddr.IPv6, number]> = [
  [ipaddr.IPv6.parse('64:ff9b:1::'), 48],
  [ipaddr.IPv6.parse('100:0:0:1::'), 64],
  [ipaddr.IPv6.parse('3fff::'), 20],
  [ipaddr.IPv6.parse('5f00::'), 16]
]

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

  return (
    BLOCKED_IPV6_RANGES.has(address.range()) ||
    BLOCKED_IPV6_CIDR_RANGES.some(([rangeAddress, bits]) => address.match(rangeAddress, bits))
  )
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

/**
 * Literal URL guard: rejects non-http(s) schemes, embedded credentials, and
 * literal local/private addresses, returning the normalized URL.
 * Pass `configuredApiHost` to allow a provider's own loopback/private endpoint
 * when it matches the user-configured host.
 *
 * Direct main-process fetches should use `resolveRemoteFetchUrl()` so hostname
 * DNS results are checked before the network request and can be pinned.
 */
export function sanitizeRemoteUrl(rawUrl: string, configuredApiHost?: string): string {
  const parsedUrl = parseRemoteUrl(rawUrl)

  const allowMatchingConfiguredOrigin =
    configuredApiHost !== undefined && hasMatchingConfiguredOrigin(parsedUrl, configuredApiHost)

  if (isBlockedHostname(parsedUrl.hostname) && !allowMatchingConfiguredOrigin) {
    throw new Error(`Unsafe remote url: local or private addresses are not allowed (${parsedUrl.hostname})`)
  }

  return parsedUrl.toString()
}

function getAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  return new Error(signal.reason ? String(signal.reason) : 'Operation aborted')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw getAbortError(signal)
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return operation
  }

  const abortSignal = signal

  throwIfAborted(abortSignal)

  return new Promise((resolve, reject) => {
    function cleanup(): void {
      abortSignal.removeEventListener('abort', onAbort)
    }

    function onAbort(): void {
      cleanup()
      reject(getAbortError(abortSignal))
    }

    abortSignal.addEventListener('abort', onAbort, { once: true })

    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}

/**
 * SSRF guard for direct main-process fetches. Combines literal URL validation
 * with DNS-level rejection for hostnames that resolve to private/local addresses.
 */
export async function resolveRemoteFetchUrl(
  rawUrl: string,
  options: ResolveRemoteFetchUrlOptions = {}
): Promise<ResolvedRemoteFetchUrl> {
  const safeUrl = sanitizeRemoteUrl(rawUrl)
  const parsedUrl = parseRemoteUrl(safeUrl)
  const address = await resolveRemoteFetchAddress(parsedUrl, options.signal)

  return { url: safeUrl, address }
}

async function resolveRemoteFetchAddress(parsedUrl: URL, signal: AbortSignal | undefined): Promise<RemoteFetchAddress> {
  throwIfAborted(signal)

  if (isBlockedHostname(parsedUrl.hostname)) {
    throw new Error(`Unsafe remote url: local or private addresses are not allowed (${parsedUrl.hostname})`)
  }

  const literalAddress = parseIpHostname(parsedUrl.hostname)
  if (literalAddress) {
    return toRemoteFetchAddress(literalAddress)
  }

  const addresses = await raceWithAbort(lookup(normalizeHostname(parsedUrl.hostname), { all: true }), signal)
  const blockedAddress = addresses.find((address) => isBlockedIpHostname(address.address))

  if (blockedAddress) {
    throw new Error(
      `Unsafe remote url: DNS resolved to local or private address (${parsedUrl.hostname} -> ${blockedAddress.address})`
    )
  }

  const firstAddress = addresses[0]
  if (!firstAddress) {
    throw new Error(`Unsafe remote url: DNS returned no addresses (${parsedUrl.hostname})`)
  }

  return toRemoteFetchAddress(firstAddress)
}

function toRemoteFetchAddress(address: ipaddr.IPv4 | ipaddr.IPv6 | LookupAddress): RemoteFetchAddress {
  if ('kind' in address) {
    return {
      address: address.toString(),
      family: address.kind() === 'ipv4' ? 4 : 6
    }
  }

  if (address.family !== 4 && address.family !== 6) {
    throw new Error(`Unsafe remote url: unsupported DNS address family (${address.family})`)
  }

  return {
    address: address.address,
    family: address.family
  }
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
