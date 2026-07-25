import type { IncomingHttpHeaders } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { LookupFunction } from 'node:net'

import { type ResolvedRemoteFetchUrl, resolveRemoteFetchUrl } from './remoteUrlSafety'

export const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 30000
export const DEFAULT_REMOTE_FETCH_MAX_BYTES = 1024 * 1024

export type FetchRemoteTextOptions = {
  readonly headers?: HeadersInit
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxBytes?: number
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
    method: 'GET',
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

async function fetchRemoteTextFromUrl(
  url: string,
  options: ResolvedFetchRemoteTextOptions,
  signal: AbortSignal,
  redirectsRemaining: number
): Promise<string> {
  const target = await resolveRemoteFetchUrl(url, { signal })
  const requestOptions = getRequestOptions(target, options, signal)
  const request = target.url.startsWith('https:') ? httpsRequest : httpRequest
  const maxBytes = options.maxBytes ?? DEFAULT_REMOTE_FETCH_MAX_BYTES

  return new Promise((resolve, reject) => {
    let settled = false

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
        void fetchRemoteTextFromUrl(redirectUrl.toString(), options, signal, redirectsRemaining - 1).then(
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
      if (contentLength !== undefined && contentLength > maxBytes) {
        response.resume()
        response.destroy()
        fail(new Error(`Remote response too large: ${contentLength} bytes exceeds ${maxBytes} bytes`))
        return
      }

      const chunks: Buffer[] = []
      let totalBytes = 0

      response.on('data', (chunk: Buffer | string) => {
        if (settled) {
          return
        }

        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        totalBytes += buffer.length

        if (totalBytes > maxBytes) {
          response.destroy()
          fail(new Error(`Remote response too large: exceeded ${maxBytes} bytes`))
          return
        }

        chunks.push(buffer)
      })

      response.on('end', () => {
        if (settled) {
          return
        }

        settled = true
        resolve(Buffer.concat(chunks).toString('utf8'))
      })

      response.on('aborted', () => fail(new Error('Remote response aborted before completion')))
      response.on('close', () => fail(new Error('Remote response closed before completion')))
      response.on('error', fail)
    })

    clientRequest.on('error', fail)
    clientRequest.end()
  })
}

/**
 * Fetch text through a direct main-process connection pinned to a prevalidated
 * DNS address. Redirects are opt-in and response bodies are bounded.
 */
export async function fetchRemoteText(url: string, options: FetchRemoteTextOptions = {}): Promise<string> {
  const maxRedirects = options.maxRedirects ?? 0
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('maxRedirects must be a non-negative safe integer')
  }

  const signal = buildSignal(options)
  const requestOptions: ResolvedFetchRemoteTextOptions = { ...options, headers: new Headers(options.headers) }
  return fetchRemoteTextFromUrl(url, requestOptions, signal, maxRedirects)
}
