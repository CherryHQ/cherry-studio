import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { LookupFunction } from 'node:net'

import { loggerService } from '@logger'
import { isAbortError } from '@main/utils/error'
import { type ResolvedRemoteFetchUrl, resolveRemoteFetchUrl } from '@main/utils/remoteUrlSafety'
import { Readability } from '@mozilla/readability'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

const logger = loggerService.withContext('MainWebSearchContentFetcher')
const turndownService = new TurndownService()
const SAFE_JSDOM_URL = 'http://localhost/'
const FETCH_TIMEOUT_MS = 30000

function buildHeaders(headers?: HeadersInit) {
  const resolvedHeaders = new Headers(headers)

  if (!resolvedHeaders.has('User-Agent')) {
    resolvedHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
  }

  return resolvedHeaders
}

function buildRequestHeaders(headers: HeadersInit | undefined, host: string): Record<string, string> {
  const resolvedHeaders = buildHeaders(headers)
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

function getRequestOptions(
  target: ResolvedRemoteFetchUrl,
  httpOptions: RequestInit,
  signal: AbortSignal
): RequestOptions {
  const parsedUrl = new URL(target.url)
  const isHttps = parsedUrl.protocol === 'https:'

  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: httpOptions.method || 'GET',
    headers: buildRequestHeaders(httpOptions.headers, parsedUrl.host),
    lookup: createLookup(target),
    agent: false,
    signal,
    servername: isHttps ? parsedUrl.hostname : undefined
  }
}

function fetchHtmlWithValidatedAddress(target: ResolvedRemoteFetchUrl, httpOptions: RequestInit): Promise<string> {
  const signal = httpOptions.signal
    ? AbortSignal.any([httpOptions.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const requestOptions = getRequestOptions(target, httpOptions, signal)
  const request = target.url.startsWith('https:') ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const clientRequest = request(requestOptions, (response) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      })

      response.on('end', () => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP error: ${statusCode}`))
          return
        }

        resolve(Buffer.concat(chunks).toString('utf8'))
      })

      response.on('error', reject)
    })

    clientRequest.on('error', reject)
    clientRequest.end()
  })
}

export async function fetchWebSearchContent(url: string, httpOptions: RequestInit = {}): Promise<WebSearchResult> {
  try {
    // web_fetch is reachable from untrusted channel input and auto-allowed, so
    // direct main-process fetches must bind the connection to validated DNS results.
    const target = await resolveRemoteFetchUrl(url)
    const html = await fetchHtmlWithValidatedAddress(target, httpOptions)

    const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })
    const article = new Readability(dom.window.document).parse()
    const markdown = turndownService.turndown(article?.content || '').trim()

    return {
      title: article?.title || url,
      url,
      content: markdown,
      sourceInput: url
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to fetch ${url}`, normalizedError)
    throw error
  }
}
