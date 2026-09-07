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
  /** Skip local/private address rejection, from the `app.fetch.allow_private_network` preference. */
  readonly allowPrivateNetwork?: boolean
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
const PUBLIC_IPV6_RANGE: readonly [ipaddr.IPv6, number] = [ipaddr.IPv6.parse('2000::'), 3]
const NAT64_WELL_KNOWN_PREFIX: readonly [ipaddr.IPv6, number] = [ipaddr.IPv6.parse('64:ff9b::'), 96]
// Clash/mihomo TUN and Surge Enhanced Mode resolve every domain into this range; the answers are
// proxy handles routed back out through the tunnel, not intranet hosts.
const FAKE_IP_IPV4_RANGE: readonly [ipaddr.IPv4, number] = [ipaddr.IPv4.parse('198.18.0.0'), 15]

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

/** Embedded IPv4 of a NAT64 well-known-prefix address, which is how IPv6-only networks reach IPv4. */
function getNat64EmbeddedIpv4(address: ipaddr.IPv6): ipaddr.IPv4 | undefined {
  const [prefixAddress, prefixBits] = NAT64_WELL_KNOWN_PREFIX

  if (!address.match(prefixAddress, prefixBits)) {
    return undefined
  }

  return new ipaddr.IPv4(address.toByteArray().slice(12))
}

function isBlockedIpv4(address: ipaddr.IPv4): boolean {
  const [fakeIpAddress, fakeIpBits] = FAKE_IP_IPV4_RANGE

  return !address.match(fakeIpAddress, fakeIpBits) && BLOCKED_IPV4_RANGES.has(address.range())
}

function isBlockedIpHostname(hostname: string): boolean {
  const address = parseIpHostname(hostname)

  if (!address) {
    return false
  }

  if (address instanceof ipaddr.IPv4) {
    return isBlockedIpv4(address)
  }

  const nat64EmbeddedIpv4 = getNat64EmbeddedIpv4(address)
  if (nat64EmbeddedIpv4) {
    return isBlockedIpv4(nat64EmbeddedIpv4)
  }

  const [publicRangeAddress, publicRangeBits] = PUBLIC_IPV6_RANGE

  return (
    !address.match(publicRangeAddress, publicRangeBits) ||
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
 * Pass `allowPrivateNetwork` from the `app.fetch.allow_private_network`
 * preference when this precheck guards a `fetchRemoteText()` call, so the
 * literal guard does not reject what the pinned fetch would accept.
 *
 * Direct main-process fetches should use `resolveRemoteFetchUrl()` so hostname
 * DNS results are checked before the network request and can be pinned.
 */
export function sanitizeRemoteUrl(rawUrl: string, configuredApiHost?: string, allowPrivateNetwork = false): string {
  const parsedUrl = parseRemoteUrl(rawUrl)

  const allowMatchingConfiguredOrigin =
    configuredApiHost !== undefined && hasMatchingConfiguredOrigin(parsedUrl, configuredApiHost)

  if (!allowPrivateNetwork && isBlockedHostname(parsedUrl.hostname) && !allowMatchingConfiguredOrigin) {
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
 * `allowPrivateNetwork` drops both rejections; scheme, credential, and connection
 * pinning rules always apply.
 */
export async function resolveRemoteFetchUrl(
  rawUrl: string,
  options: ResolveRemoteFetchUrlOptions = {}
): Promise<ResolvedRemoteFetchUrl> {
  const parsedUrl = parseRemoteUrl(rawUrl)
  const allowPrivateNetwork = options.allowPrivateNetwork === true

  if (!allowPrivateNetwork && isBlockedHostname(parsedUrl.hostname)) {
    throw new Error(`Unsafe remote url: local or private addresses are not allowed (${parsedUrl.hostname})`)
  }

  const safeUrl = parsedUrl.toString()
  const address = await resolveRemoteFetchAddress(parsedUrl, options.signal, allowPrivateNetwork)

  return { url: safeUrl, address }
}

async function resolveRemoteFetchAddress(
  parsedUrl: URL,
  signal: AbortSignal | undefined,
  allowPrivateNetwork: boolean
): Promise<RemoteFetchAddress> {
  throwIfAborted(signal)

  const literalAddress = parseIpHostname(parsedUrl.hostname)
  if (literalAddress) {
    return toRemoteFetchAddress(literalAddress)
  }

  const addresses = await raceWithAbort(lookup(normalizeHostname(parsedUrl.hostname), { all: true }), signal)

  // The connection is pinned to the address returned here, so a rejected answer only has to be
  // skipped rather than fail the whole hostname.
  const safeAddress = addresses.find((address) => allowPrivateNetwork || !isBlockedIpHostname(address.address))
  if (safeAddress) {
    return toRemoteFetchAddress(safeAddress)
  }

  const blockedAddress = addresses[0]
  if (!blockedAddress) {
    throw new Error(`Unsafe remote url: DNS returned no addresses (${parsedUrl.hostname})`)
  }

  throw new Error(
    `Unsafe remote url: DNS resolved to local or private address (${parsedUrl.hostname} -> ${blockedAddress.address})`
  )
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
