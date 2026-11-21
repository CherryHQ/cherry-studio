import { createWriteStream } from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { LookupFunction } from 'node:net'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { checkServerIdentity } from 'node:tls'

import { application } from '@application'

import { REMOTE_FETCH_OWNS_ROUTE } from './remoteFetchRoute'
import { type ResolvedRemoteFetchUrl, resolveRemoteFetchUrl } from './remoteUrlSafety'

export const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 30000
export const DEFAULT_REMOTE_FETCH_MAX_BYTES = 1024 * 1024

export type FetchRemoteTextOptions = {
  readonly method?: 'GET' | 'HEAD'
  /** Use the app's applied route without allowing the proxy to re-resolve the destination. */
  readonly respectAppProxy?: boolean
  readonly allowPrivateNetwork?: boolean
  readonly headers?: HeadersInit
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxBytes?: number
  readonly byteBudget?: { remaining: number }
  readonly maxRedirects?: number
}

type ResolvedFetchRemoteTextOptions = Omit<FetchRemoteTextOptions, 'headers'> & { readonly headers: Headers }

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])
const SENSITIVE_REDIRECT_HEADERS = ['authorization', 'cookie', 'proxy-authorization'] as const

function buildRequestHeaders(headers: HeadersInit | undefined, host: string): Record<string, string> {
  const resolvedHeaders = new Headers(headers)
  resolvedHeaders.set('Host', host)

  return Object.fromEntries(resolvedHeaders.entries())
}

function createLookup(target: ResolvedRemoteFetchUrl): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [target.address])
      return
    }

    callback(null, target.address.address, target.address.family)
  }
}

function getRequestHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isIpLiteralHostname(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(hostname)
}

function getRequestOptions(
  target: ResolvedRemoteFetchUrl,
  options: FetchRemoteTextOptions,
  signal: AbortSignal
): RequestOptions {
  const parsedUrl = new URL(target.url)
  const isHttps = parsedUrl.protocol === 'https:'

  return {
    protocol: parsedUrl.protocol,
    hostname: getRequestHostname(parsedUrl.hostname),
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: options.method ?? 'GET',
    headers: buildRequestHeaders(options.headers, parsedUrl.host),
    lookup: createLookup(target),
    agent: false,
    signal,
    servername: isHttps && !isIpLiteralHostname(parsedUrl.hostname) ? parsedUrl.hostname : undefined
  }
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]

  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function parseContentLength(headers: IncomingHttpHeaders): number | undefined {
  const contentLength = getHeaderValue(headers, 'content-length')
  if (!contentLength) {
    return undefined
  }

  const parsed = Number(contentLength)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function buildSignal(options: FetchRemoteTextOptions): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_REMOTE_FETCH_TIMEOUT_MS)

  return options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
}

async function readProxyRoute(url: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    void application
      .get('ProxyService')
      .getRemoteFetchProxy(url)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', abort)
      })
  })
}

async function fetchRemoteResponse(
  url: string,
  options: ResolvedFetchRemoteTextOptions,
  signal: AbortSignal,
  redirectsRemaining: number,
  destination?: string
): Promise<{ body: Buffer; headers: IncomingHttpHeaders; url: string }> {
  const target = await resolveRemoteFetchUrl(url, {
    signal,
    allowPrivateNetwork:
      options.allowPrivateNetwork ?? application.get('PreferenceService').get('app.fetch.allow_private_network')
  })
  const requestOptions: RequestOptions & { [REMOTE_FETCH_OWNS_ROUTE]?: boolean } = getRequestOptions(
    target,
    options,
    signal
  )
  if (options.respectAppProxy) {
    const proxyUrl = await readProxyRoute(target.url, signal)
    requestOptions[REMOTE_FETCH_OWNS_ROUTE] = true
    if (proxyUrl) {
      const proxyProtocol = new URL(proxyUrl).protocol
      if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(proxyProtocol)) {
        throw new Error('Unsupported app proxy protocol')
      }
      // Proxy agents receive only the validated IP. Host and TLS servername keep
      // the original origin; the proxy never gets an opportunity to rebind DNS.
      requestOptions.hostname = target.address.address
      const originHostname = getRequestHostname(new URL(target.url).hostname)
      // tls.connect over an existing tunnel has no host for IP-literal URLs
      // and otherwise defaults certificate identity to localhost.
      requestOptions.checkServerIdentity = (_hostname, certificate) => checkServerIdentity(originHostname, certificate)
      if (proxyProtocol.startsWith('socks')) {
        const { SocksProxyAgent } = await import('socks-proxy-agent')
        requestOptions.agent = new SocksProxyAgent(proxyUrl, {
          timeout: options.timeoutMs ?? DEFAULT_REMOTE_FETCH_TIMEOUT_MS,
          socketOptions: { signal }
        })
      } else {
        const { HttpsProxyAgent } = await import('https-proxy-agent')
        // CONNECT works for HTTP and HTTPS and avoids absolute-form HTTP proxy
        // requests reconstructing the hostname from the original Host header.
        requestOptions.agent = new HttpsProxyAgent(proxyUrl, { signal })
      }
    }
  }
  const proxyAgent =
    options.respectAppProxy && typeof requestOptions.agent === 'object' ? requestOptions.agent : undefined
  try {
    signal.throwIfAborted()
    return await sendRemoteRequest(target, options, signal, redirectsRemaining, requestOptions, destination)
  } finally {
    proxyAgent?.destroy()
  }
}

async function sendRemoteRequest(
  target: ResolvedRemoteFetchUrl,
  options: ResolvedFetchRemoteTextOptions,
  signal: AbortSignal,
  redirectsRemaining: number,
  requestOptions: RequestOptions,
  destination?: string
): Promise<{ body: Buffer; headers: IncomingHttpHeaders; url: string }> {
  const request = target.url.startsWith('https:') ? httpsRequest : httpRequest
  const maxBytes = options.maxBytes ?? DEFAULT_REMOTE_FETCH_MAX_BYTES

  return new Promise((resolve, reject) => {
    let settled = false
    let fileResponse: IncomingMessage | undefined

    const fail = (error: Error): void => {
      if (settled) {
        return
      }

      settled = true
      reject(signal.aborted && signal.reason instanceof Error ? signal.reason : error)
    }

    const clientRequest = request(requestOptions, (response) => {
      const statusCode = response.statusCode ?? 0

      if (REDIRECT_STATUS_CODES.has(statusCode)) {
        const location = getHeaderValue(response.headers, 'location')
        if (!location || redirectsRemaining === 0) {
          response.resume()
          response.destroy()
          fail(new Error(`HTTP error: ${statusCode}`))
          return
        }

        let redirectUrl: URL
        try {
          redirectUrl = new URL(location, target.url)
        } catch {
          response.resume()
          response.destroy()
          fail(new Error(`Invalid redirect location: ${location}`))
          return
        }

        if (redirectUrl.origin !== new URL(target.url).origin) {
          for (const header of SENSITIVE_REDIRECT_HEADERS) {
            options.headers.delete(header)
          }
        }

        settled = true
        response.resume()
        response.destroy()
        void fetchRemoteResponse(redirectUrl.toString(), options, signal, redirectsRemaining - 1, destination).then(
          resolve,
          reject
        )
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        response.destroy()
        fail(new Error(`HTTP error: ${statusCode}`))
        return
      }

      const contentLength = parseContentLength(response.headers)
      if (options.method !== 'HEAD' && contentLength !== undefined && contentLength > maxBytes) {
        response.resume()
        response.destroy()
        fail(new Error(`Remote response too large: ${contentLength} bytes exceeds ${maxBytes} bytes`))
        return
      }

      let totalBytes = 0
      const checkChunk = (buffer: Buffer): Error | undefined => {
        totalBytes += buffer.length
        if (totalBytes > maxBytes) {
          return new Error(`Remote response too large: exceeded ${maxBytes} bytes`)
        }
        if (options.byteBudget) {
          if (buffer.length > options.byteBudget.remaining) {
            return new Error('Remote responses exceeded the shared byte budget')
          }
          options.byteBudget.remaining -= buffer.length
        }
        return undefined
      }

      if (destination !== undefined) {
        fileResponse = response
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            callback(checkChunk(chunk), chunk)
          }
        })
        void pipeline(response, limiter, createWriteStream(destination, { flags: 'wx' }), { signal }).then(() => {
          settled = true
          resolve({ body: Buffer.alloc(0), headers: response.headers, url: target.url })
        }, fail)
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => {
        if (settled) return
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        const error = checkChunk(buffer)
        if (error) {
          fail(error)
          response.destroy()
          return
        }
        chunks.push(buffer)
      })

      response.on('end', () => {
        if (settled) {
          return
        }

        settled = true
        resolve({ body: Buffer.concat(chunks), headers: response.headers, url: target.url })
      })

      response.on('aborted', () => fail(new Error('Remote response aborted before completion')))
      response.on('close', () => fail(new Error('Remote response closed before completion')))
      response.on('error', fail)
    })

    clientRequest.on('error', (error) => {
      if (fileResponse) fileResponse.destroy(error)
      else fail(error)
    })
    clientRequest.end()
  })
}

/**
 * Fetch text through a connection pinned to a prevalidated DNS address. Direct
 * by default; respectAppProxy opts into the applied app route with the same pin.
 * Redirects are opt-in and response bodies are bounded.
 */
export async function fetchRemoteText(url: string, options: FetchRemoteTextOptions = {}): Promise<string> {
  return (await fetchRemoteBytes(url, options)).body.toString('utf8')
}

/** Fetch bounded binary data using the same DNS, redirect and cancellation policy as text. */
export async function fetchRemoteBytes(
  url: string,
  options: FetchRemoteTextOptions = {}
): Promise<{ body: Buffer; headers: IncomingHttpHeaders }> {
  const { body, headers } = await fetchRemoteBytesWithUrl(url, options)
  return { body, headers }
}

/** Also expose the final validated URL for resolving relative links after redirects. */
export async function fetchRemoteBytesWithUrl(
  url: string,
  options: FetchRemoteTextOptions = {}
): Promise<{ body: Buffer; headers: IncomingHttpHeaders; url: string }> {
  return fetchRemote(url, options)
}

/** Stream a bounded download into a new file; the caller owns cleanup if the download fails. */
export async function fetchRemoteFile(
  url: string,
  destination: string,
  options: FetchRemoteTextOptions = {}
): Promise<void> {
  await fetchRemote(url, options, destination)
}

async function fetchRemote(url: string, options: FetchRemoteTextOptions, destination?: string) {
  const maxRedirects = options.maxRedirects ?? 0
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('maxRedirects must be a non-negative safe integer')
  }

  const signal = buildSignal(options)
  const requestOptions: ResolvedFetchRemoteTextOptions = { ...options, headers: new Headers(options.headers) }
  return fetchRemoteResponse(url, requestOptions, signal, maxRedirects, destination)
}
