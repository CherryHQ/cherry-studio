import { randomUUID } from 'node:crypto'
import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'

import { loggerService } from '@logger'
import { installBundledDevtools } from '@main/core/devtools'
import { BaseService, Conditional, Injectable, Phase, Priority, ServicePhase, when } from '@main/core/lifecycle'
import { isDev } from '@main/core/platform'
import { net } from 'electron'
import WebSocket, { WebSocketServer } from 'ws'

const logger = loggerService.withContext('MainNetworkDevtoolsService')

// Fixed localhost port the bundled DevTools panel connects to. Keep in sync with
// resources/devtools/main-network/panel.js.
const MAIN_NETWORK_DEVTOOLS_DEFAULT_PORT = 38997

const MAX_EVENTS = 1000
const MAX_BODY_CHARS = 128 * 1024
const REDACTED = '[redacted]'
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-api-token'
])
const SENSITIVE_QUERY_NAMES = new Set([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'code',
  'key',
  'password',
  'secret',
  'token'
])

type RequestLike = (...args: unknown[]) => ClientRequest

interface MutableClientRequestMethods {
  write: (...args: unknown[]) => boolean
  end: (...args: unknown[]) => ClientRequest
}

type MainNetworkDevtoolsState = 'pending' | 'success' | 'error'
type MainNetworkDevtoolsSource = 'fetch' | 'http' | 'https' | 'net'

export interface MainNetworkDevtoolsBody {
  text?: string
  contentType?: string
  truncated?: boolean
  size?: number
  note?: string
}

export interface MainNetworkDevtoolsEvent {
  id: string
  source: MainNetworkDevtoolsSource
  state: MainNetworkDevtoolsState
  method: string
  url: string
  requestHeaders?: Record<string, string>
  requestBody?: MainNetworkDevtoolsBody
  responseHeaders?: Record<string, string>
  responseBody?: MainNetworkDevtoolsBody
  responseBodyError?: string
  status?: number
  statusText?: string
  error?: string
  startedAt: number
  responseStartedAt?: number
  completedAt?: number
  duration?: number
}

interface RequestDescription {
  method: string
  url: string
  requestHeaders?: Record<string, string>
  requestBody?: MainNetworkDevtoolsBody
  requestContentType?: string
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)

    if (url.username) url.username = REDACTED
    if (url.password) url.password = REDACTED

    for (const [key] of [...url.searchParams]) {
      if (isSensitiveName(key, SENSITIVE_QUERY_NAMES)) {
        url.searchParams.set(key, REDACTED)
      }
    }

    return url.toString()
  } catch {
    return rawUrl
  }
}

export function redactHeaders(
  headers: Headers | Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined

  const result: Record<string, string> = {}
  const entries: [string, unknown][] = []

  if (typeof (headers as Headers).forEach === 'function') {
    ;(headers as Headers).forEach((value, key) => entries.push([key, value]))
  } else {
    entries.push(...Object.entries(headers))
  }

  for (const [key, value] of entries) {
    if (value === undefined) continue
    result[key] = isSensitiveHeaderName(key) ? REDACTED : normalizeHeaderValue(value)
  }

  return Object.keys(result).length > 0 ? result : undefined
}

export function describeHttpRequest(source: 'http' | 'https', args: unknown[]): RequestDescription {
  const defaultProtocol = source === 'https' ? 'https:' : 'http:'
  const firstArg = args[0]
  const secondArg = args[1]

  let urlArg: string | URL | undefined
  let options: RequestOptions = {}

  if (typeof firstArg === 'string' || firstArg instanceof URL) {
    urlArg = firstArg
    if (isRequestOptions(secondArg)) {
      options = secondArg
    }
  } else if (isRequestOptions(firstArg)) {
    options = firstArg
  }

  const parsedUrl = parseUrlArg(urlArg)
  const protocol = normalizeOptionValue(options.protocol) ?? parsedUrl?.protocol ?? defaultProtocol
  const host = normalizeOptionValue(options.hostname ?? options.host) ?? parsedUrl?.host ?? 'unknown'
  const port = normalizeOptionValue(options.port)
  const authority = port && !host.includes(':') ? `${host}:${port}` : host
  const path = normalizeOptionValue(options.path) ?? getUrlPath(parsedUrl) ?? getFallbackPath(urlArg)
  const normalizedPath =
    path.startsWith('/') || path.startsWith('http://') || path.startsWith('https://') ? path : `/${path}`

  const requestHeaders = redactHeaders(options.headers as Record<string, unknown> | undefined)

  return {
    method: String(options.method ?? 'GET').toUpperCase(),
    url: redactUrl(`${protocol}//${authority}${normalizedPath}`),
    requestHeaders,
    requestContentType: getHeaderValue(requestHeaders, 'content-type')
  }
}

/**
 * Development-only monitor for network requests initiated by this main-process
 * JavaScript runtime (`fetch`, Electron `net.fetch`, and Node `http`/`https`).
 *
 * Known limitations: traffic emitted by native binaries or child processes is
 * not visible to these in-process monkey patches. In particular, Claude agent SDK
 * / Claude Code requests may be performed by the SDK-managed native executable
 * and therefore do not appear in this panel. Node `http`/`https` response bodies
 * are intentionally skipped to avoid changing stream consumption behavior.
 */
@Injectable('MainNetworkDevtoolsService')
@ServicePhase(Phase.Background)
@Priority(0)
@Conditional(when(() => isDev, 'development mode'))
export class MainNetworkDevtoolsService extends BaseService {
  private readonly events: MainNetworkDevtoolsEvent[] = []
  private readonly clients = new Set<WebSocket>()
  private readonly allowedOrigins = new Set<string>()
  private originalFetch: typeof globalThis.fetch | undefined
  private originalNetFetch: typeof net.fetch | undefined
  private originalHttpGet: typeof http.get | null = null
  private originalHttpRequest: typeof http.request | null = null
  private originalHttpsGet: typeof https.get | null = null
  private originalHttpsRequest: typeof https.request | null = null
  private monitoredHttpGet: typeof http.get | null = null
  private monitoredHttpRequest: typeof http.request | null = null
  private monitoredHttpsGet: typeof https.get | null = null
  private monitoredHttpsRequest: typeof https.request | null = null

  protected async onInit(): Promise<void> {
    this.patchFetch()
    this.patchNetFetch()
    this.patchHttpModules()

    try {
      await this.startWebSocketServer()
    } catch (error) {
      logger.error('Failed to start Main Network DevTools websocket server', error as Error)
    }
  }

  /**
   * Install the panel here rather than in onInit: this service runs in the Background
   * phase, which Application.bootstrap starts *before* awaiting app.whenReady(), so
   * onInit would hit `session.defaultSession` too early and throw "Session can only be
   * received when app is ready". onAllReady fires after every phase completes, by which
   * point the app is ready. Registering the panel only has to precede the user opening
   * DevTools, so the extra wait costs nothing.
   *
   * Patching stays in onInit — it must cover requests made during early boot.
   */
  protected async onAllReady(): Promise<void> {
    await this.installPanel()
  }

  /**
   * Install this devtool's own bundled panel and allowlist its extension origin.
   * core owns only the generic bundled-panel installer; the concrete devtool
   * registers itself here rather than having core know about it.
   */
  private async installPanel(): Promise<void> {
    await installBundledDevtools('main-network', 'Main Network', (extension) => {
      this.registerOrigin(`chrome-extension://${extension.id}`)
    })
  }

  private registerOrigin(origin: string): void {
    this.allowedOrigins.add(normalizeOrigin(origin))
  }

  private isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return false
    return this.allowedOrigins.has(normalizeOrigin(origin))
  }

  private patchFetch(): void {
    if (typeof globalThis.fetch !== 'function') return

    this.originalFetch = globalThis.fetch
    const originalFetch = this.originalFetch

    const monitoredFetch: typeof globalThis.fetch = async (input, init) => {
      const startedAt = performance.now()
      const description = describeFetchRequest(input, init)
      const id = this.recordStarted('fetch', description)
      this.captureFetchRequestBodyFromRequest(id, input, description)

      try {
        const response = await originalFetch.call(globalThis, input, init)
        this.updateEvent(id, {
          ...getHttpStatusPatch(response.status, response.statusText),
          status: response.status,
          statusText: response.statusText,
          responseHeaders: redactHeaders(response.headers),
          completedAt: Date.now(),
          duration: performance.now() - startedAt
        })
        this.captureFetchResponseBody(id, response)
        return response
      } catch (error) {
        this.updateEvent(id, {
          state: 'error',
          error: getErrorMessage(error),
          completedAt: Date.now(),
          duration: performance.now() - startedAt
        })
        throw error
      }
    }

    globalThis.fetch = monitoredFetch
    this.registerDisposable(() => {
      if (globalThis.fetch === monitoredFetch && this.originalFetch) {
        globalThis.fetch = this.originalFetch
      }
    })
  }

  private patchNetFetch(): void {
    if (typeof net.fetch !== 'function') return

    this.originalNetFetch = net.fetch
    const originalNetFetch = this.originalNetFetch

    const monitoredNetFetch: typeof net.fetch = async (input, init) => {
      const startedAt = performance.now()
      const description = describeFetchRequest(input, init)
      const id = this.recordStarted('net', description)
      this.captureFetchRequestBodyFromRequest(id, input, description)

      try {
        const response = await originalNetFetch.call(net, input, init)
        this.updateEvent(id, {
          ...getHttpStatusPatch(response.status, response.statusText),
          status: response.status,
          statusText: response.statusText,
          responseHeaders: redactHeaders(response.headers),
          completedAt: Date.now(),
          duration: performance.now() - startedAt
        })
        this.captureFetchResponseBody(id, response)
        return response
      } catch (error) {
        this.updateEvent(id, {
          state: 'error',
          error: getErrorMessage(error),
          completedAt: Date.now(),
          duration: performance.now() - startedAt
        })
        throw error
      }
    }

    net.fetch = monitoredNetFetch
    this.registerDisposable(() => {
      if (net.fetch === monitoredNetFetch && this.originalNetFetch) {
        net.fetch = this.originalNetFetch
      }
    })
  }

  private patchHttpModules(): void {
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request

    this.monitoredHttpGet = this.wrapHttpMethod(this.originalHttpGet as RequestLike, 'http') as typeof http.get
    this.monitoredHttpRequest = this.wrapHttpMethod(
      this.originalHttpRequest as RequestLike,
      'http'
    ) as typeof http.request
    this.monitoredHttpsGet = this.wrapHttpMethod(this.originalHttpsGet as RequestLike, 'https') as typeof https.get
    this.monitoredHttpsRequest = this.wrapHttpMethod(
      this.originalHttpsRequest as RequestLike,
      'https'
    ) as typeof https.request

    http.get = this.monitoredHttpGet
    http.request = this.monitoredHttpRequest
    https.get = this.monitoredHttpsGet
    https.request = this.monitoredHttpsRequest

    this.registerDisposable(() => {
      if (this.monitoredHttpGet && http.get === this.monitoredHttpGet && this.originalHttpGet)
        http.get = this.originalHttpGet
      if (this.monitoredHttpRequest && http.request === this.monitoredHttpRequest && this.originalHttpRequest) {
        http.request = this.originalHttpRequest
      }
      if (this.monitoredHttpsGet && https.get === this.monitoredHttpsGet && this.originalHttpsGet) {
        https.get = this.originalHttpsGet
      }
      if (this.monitoredHttpsRequest && https.request === this.monitoredHttpsRequest && this.originalHttpsRequest) {
        https.request = this.originalHttpsRequest
      }
    })
  }

  private wrapHttpMethod(originalMethod: RequestLike, source: 'http' | 'https'): RequestLike {
    return (...args: unknown[]) => {
      const startedAt = performance.now()
      const description = describeHttpRequest(source, args)
      const id = this.recordStarted(source, description)
      let request: ClientRequest

      try {
        request = originalMethod(...args)
      } catch (error) {
        this.updateEvent(id, {
          state: 'error',
          error: getErrorMessage(error),
          completedAt: Date.now(),
          duration: performance.now() - startedAt
        })
        throw error
      }

      this.trackClientRequest(request, id, startedAt, description.requestContentType)
      return request
    }
  }

  private trackClientRequest(
    request: ClientRequest,
    id: string,
    startedAt: number,
    requestContentType: string | undefined
  ): void {
    let completed = false
    const complete = (patch: Partial<MainNetworkDevtoolsEvent>) => {
      if (completed) return
      completed = true
      this.updateEvent(id, {
        ...patch,
        completedAt: Date.now(),
        duration: performance.now() - startedAt
      })
    }

    this.captureClientRequestBody(request, id, requestContentType)

    request.once('response', (response: IncomingMessage) => {
      const responseHeaders = redactHeaders(response.headers)
      const contentType = getHeaderValue(responseHeaders, 'content-type')
      const statusPatch = getHttpStatusPatch(response.statusCode, response.statusMessage)
      this.updateEvent(id, {
        status: response.statusCode,
        statusText: response.statusMessage,
        responseHeaders,
        responseStartedAt: Date.now()
      })
      complete({
        ...statusPatch,
        responseBody: {
          contentType,
          note: 'Node http/https response body capture is skipped to avoid changing stream consumption.'
        }
      })
    })

    request.once('error', (error) => complete({ state: 'error', error: getErrorMessage(error) }))
    request.once('timeout', () => this.updateEvent(id, { error: 'Request timed out' }))
  }

  private captureFetchRequestBodyFromRequest(
    id: string,
    input: Parameters<typeof globalThis.fetch>[0],
    description: RequestDescription
  ): void {
    if (description.requestBody || typeof Request === 'undefined' || !(input instanceof Request) || !input.body) return

    const contentType = description.requestContentType
    // Do not clone non-text bodies: Request.clone() tees the stream, and the unread
    // clone branch would buffer the whole binary payload without backpressure.
    if (!isTextLikeContentType(contentType)) {
      this.updateEvent(id, { requestBody: { contentType, note: 'Binary request body is not captured.' } })
      return
    }

    let clonedRequest: Request
    try {
      clonedRequest = input.clone()
    } catch (error) {
      this.updateEvent(id, { requestBody: { contentType, note: getErrorMessage(error) } })
      return
    }

    void readWebBody(clonedRequest.body, contentType, 'No request body.')
      .then((requestBody) => this.updateEvent(id, { requestBody }))
      .catch((error) => this.updateEvent(id, { requestBody: { contentType, note: getErrorMessage(error) } }))
  }

  private captureFetchResponseBody(id: string, response: Response): void {
    const contentType = getHeaderValue(redactHeaders(response.headers), 'content-type')
    // Do not clone non-text bodies: Response.clone() tees the stream, and the unread
    // clone branch would buffer the whole binary payload without backpressure.
    if (!isTextLikeContentType(contentType)) {
      this.updateEvent(id, { responseBody: { contentType, note: 'Binary response body is not captured.' } })
      return
    }

    let clonedResponse: Response
    try {
      clonedResponse = response.clone()
    } catch (error) {
      this.updateEvent(id, { responseBodyError: getErrorMessage(error) })
      return
    }

    void readWebBody(clonedResponse.body, contentType, 'No response body.')
      .then((responseBody) => this.updateEvent(id, { responseBody }))
      .catch((error) => this.updateEvent(id, { responseBodyError: getErrorMessage(error) }))
  }

  private captureClientRequestBody(request: ClientRequest, id: string, contentType: string | undefined): void {
    const requestBodyAccumulator = createBodyAccumulator(contentType)
    const target = request as unknown as MutableClientRequestMethods
    const originalWrite = target.write
    const originalEnd = target.end
    const updateRequestBody = (requestBody: MainNetworkDevtoolsBody) => this.updateEvent(id, { requestBody })

    target.write = function monitoredWrite(this: ClientRequest, ...args: unknown[]) {
      requestBodyAccumulator.append(args[0], args[1])
      return originalWrite.apply(this, args)
    }

    target.end = function monitoredEnd(this: ClientRequest, ...args: unknown[]) {
      requestBodyAccumulator.append(args[0], args[1])
      const requestBody = requestBodyAccumulator.toBody()
      if (requestBody) {
        // Queue the update after Node has accepted `end()` so diagnostics cannot affect request dispatch.
        queueMicrotask(() => updateRequestBody(requestBody))
      }
      return originalEnd.apply(this, args)
    }
  }

  private recordStarted(source: MainNetworkDevtoolsSource, description: RequestDescription): string {
    const event: MainNetworkDevtoolsEvent = {
      id: randomUUID(),
      source,
      state: 'pending',
      method: description.method,
      url: description.url,
      requestHeaders: description.requestHeaders,
      requestBody: description.requestBody,
      startedAt: Date.now()
    }

    this.events.push(event)
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS)
      this.broadcast({ type: 'snapshot', events: this.events })
      return event.id
    }

    this.broadcast({ type: 'event', event })

    return event.id
  }

  private updateEvent(id: string, patch: Partial<MainNetworkDevtoolsEvent>): void {
    const event = this.events.find((item) => item.id === id)
    if (!event) return

    Object.assign(event, patch)
    this.broadcast({ type: 'event', event })
  }

  private async startWebSocketServer(port = MAIN_NETWORK_DEVTOOLS_DEFAULT_PORT): Promise<number> {
    const server = new WebSocketServer({ host: '127.0.0.1', port })

    server.on('error', (error) => {
      logger.error('Main Network DevTools websocket server error', error)
    })

    server.on('connection', (socket, request) => {
      if (!this.isOriginAllowed(request.headers.origin)) {
        socket.close(1008, 'Unauthorized origin')
        return
      }

      this.clients.add(socket)
      socket.send(JSON.stringify({ type: 'snapshot', events: this.events }))
      socket.on('message', (raw) => this.handleClientMessage(raw.toString()))
      socket.on('close', () => this.clients.delete(socket))
      socket.on('error', () => this.clients.delete(socket))
    })

    try {
      await waitForServerListening(server)
    } catch (error) {
      server.close()
      throw error
    }

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Main Network DevTools websocket server did not expose a TCP port')
    }

    const listeningPort = (address as AddressInfo).port
    logger.info(`Main Network DevTools websocket server listening on 127.0.0.1:${listeningPort}`)

    this.registerDisposable(() => {
      for (const client of this.clients) client.close()
      this.clients.clear()
      server.close()
    })

    return listeningPort
  }

  private handleClientMessage(raw: string): void {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (!isRecord(message) || message.type !== 'clear') return

    this.events.splice(0)
    this.broadcast({ type: 'cleared' })
  }

  private broadcast(message: unknown): void {
    if (this.clients.size === 0) return

    const payload = JSON.stringify(message)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload)
      }
    }
  }
}

function describeFetchRequest(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1]
) {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
  const headers = request ? new Headers(request.headers) : new Headers()

  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  const requestHeaders = redactHeaders(headers)
  const requestContentType = getHeaderValue(requestHeaders, 'content-type')

  return {
    method: String(init?.method ?? request?.method ?? 'GET').toUpperCase(),
    url: redactUrl(getFetchUrl(input)),
    requestHeaders,
    requestBody: captureRequestBody(init?.body, requestContentType),
    requestContentType
  }
}

function getFetchUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return String(input)
}

function parseUrlArg(urlArg: string | URL | undefined): URL | undefined {
  if (!urlArg) return undefined
  try {
    return new URL(urlArg.toString())
  } catch {
    return undefined
  }
}

function getUrlPath(url: URL | undefined): string | undefined {
  if (!url) return undefined
  return `${url.pathname}${url.search}`
}

function getFallbackPath(urlArg: string | URL | undefined): string {
  if (typeof urlArg === 'string') return urlArg || '/'
  return '/'
}

function isRequestOptions(value: unknown): value is RequestOptions {
  return Boolean(value) && typeof value === 'object' && !(value instanceof URL)
}

function normalizeOptionValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  return String(value)
}

function getHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const normalizedName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value
  }
  return undefined
}

export function captureRequestBody(body: unknown, contentType?: string): MainNetworkDevtoolsBody | undefined {
  if (body === undefined || body === null) return undefined

  if (typeof body === 'string') return createCapturedTextBody(body, contentType)
  if (body instanceof URLSearchParams)
    return createCapturedTextBody(body.toString(), 'application/x-www-form-urlencoded')
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return createCapturedTextBody(JSON.stringify(formDataToRecord(body)), contentType ?? 'multipart/form-data')
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return {
      contentType: contentType ?? (body.type || undefined),
      size: body.size,
      note: 'Blob request body is not captured.'
    }
  }
  if (body instanceof ArrayBuffer) return createCapturedBinaryBody(new Uint8Array(body), contentType)
  if (ArrayBuffer.isView(body)) {
    return createCapturedBinaryBody(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType)
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return { contentType, note: 'Streaming request body is not captured.' }
  }

  return createCapturedTextBody(String(body), contentType)
}

async function readWebBody(
  body: ReadableStream<Uint8Array> | null,
  contentType: string | undefined,
  emptyNote: string
): Promise<MainNetworkDevtoolsBody> {
  if (!body) return { contentType, note: emptyNote }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

  try {
    let done = false
    while (text.length < MAX_BODY_CHARS) {
      const result = await reader.read()
      done = result.done
      if (done) break
      text += decoder.decode(result.value, { stream: true })
    }
    text += decoder.decode()

    if (text.length > MAX_BODY_CHARS) {
      text = text.slice(0, MAX_BODY_CHARS)
      truncated = true
    }
    if (!done && text.length >= MAX_BODY_CHARS) truncated = true

    if (truncated) {
      await reader.cancel().catch(() => {})
    }
  } finally {
    reader.releaseLock()
  }

  return createCapturedTextBody(text, contentType, truncated)
}

function createBodyAccumulator(contentType?: string) {
  let text = ''
  let size = 0
  let truncated = false
  let note: string | undefined

  const appendText = (value: string) => {
    size += value.length
    if (text.length >= MAX_BODY_CHARS) {
      truncated = true
      return
    }

    const remaining = MAX_BODY_CHARS - text.length
    text += value.slice(0, remaining)
    if (value.length > remaining) truncated = true
  }

  return {
    append(chunk: unknown, encoding?: unknown) {
      if (chunk === undefined || chunk === null || typeof chunk === 'function') return
      if (!isTextLikeContentType(contentType)) {
        note = 'Binary body is not captured.'
        size += getChunkSize(chunk)
        return
      }

      if (typeof chunk === 'string') {
        appendText(chunk)
        return
      }
      if (Buffer.isBuffer(chunk)) {
        appendText(chunk.toString(typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8'))
        return
      }
      if (chunk instanceof ArrayBuffer) {
        appendText(new TextDecoder().decode(chunk))
        return
      }
      if (ArrayBuffer.isView(chunk)) {
        appendText(new TextDecoder().decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
        return
      }

      appendText(String(chunk))
    },
    toBody(): MainNetworkDevtoolsBody | undefined {
      if (!text && size === 0 && !note) return undefined
      if (note && !text) return { contentType, size, note }
      return createCapturedTextBody(text, contentType, truncated, size)
    }
  }
}

function createCapturedBinaryBody(bytes: Uint8Array, contentType?: string): MainNetworkDevtoolsBody {
  if (!isTextLikeContentType(contentType)) {
    return { contentType, size: bytes.byteLength, note: 'Binary request body is not captured.' }
  }
  return createCapturedTextBody(new TextDecoder().decode(bytes), contentType, false, bytes.byteLength)
}

function createCapturedTextBody(
  text: string,
  contentType?: string,
  alreadyTruncated = false,
  size = text.length
): MainNetworkDevtoolsBody {
  const truncated = alreadyTruncated || text.length > MAX_BODY_CHARS
  const visibleText = text.slice(0, MAX_BODY_CHARS)
  return {
    text: redactBodyText(visibleText, contentType),
    contentType,
    size,
    truncated: truncated || undefined
  }
}

function redactBodyText(text: string, contentType?: string): string {
  if (isJsonContentType(contentType) || looksJson(text)) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(text)))
    } catch {
      return text
    }
  }

  if (isUrlEncodedContentType(contentType)) {
    const params = new URLSearchParams(text)
    for (const [key] of [...params]) {
      if (isSensitiveName(key, SENSITIVE_QUERY_NAMES)) params.set(key, REDACTED)
    }
    return params.toString()
  }

  return text
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item))
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveName(key, SENSITIVE_QUERY_NAMES) ? REDACTED : redactJsonValue(item)
  }
  return result
}

function formDataToRecord(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of formData.entries()) {
    result[key] = isSensitiveName(key, SENSITIVE_QUERY_NAMES) ? REDACTED : describeFormDataValue(value)
  }
  return result
}

function describeFormDataValue(value: FormDataEntryValue): string {
  if (typeof value === 'string') return value
  return `[file ${value.name || 'unnamed'} ${value.size} bytes]`
}

function isTextLikeContentType(contentType: string | undefined): boolean {
  if (!contentType) return true
  const normalized = contentType.toLowerCase()
  return (
    normalized.startsWith('text/') ||
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded') ||
    normalized.includes('event-stream')
  )
}

function isJsonContentType(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().includes('json') === true
}

function isUrlEncodedContentType(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().includes('x-www-form-urlencoded') === true
}

function looksJson(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function getChunkSize(chunk: unknown): number {
  if (typeof chunk === 'string') return chunk.length
  if (Buffer.isBuffer(chunk)) return chunk.byteLength
  if (chunk instanceof ArrayBuffer) return chunk.byteLength
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength
  return String(chunk).length
}

function getHttpStatusPatch(
  status: number | undefined,
  statusText: string | undefined
): Pick<MainNetworkDevtoolsEvent, 'state' | 'error'> {
  if (status !== undefined && status >= 200 && status < 300) return { state: 'success' }

  const label = [status, statusText].filter((value) => value !== undefined && value !== '').join(' ')
  return {
    state: 'error',
    error: label ? `HTTP ${label}` : 'HTTP status is not 2xx'
  }
}

function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase()
  return SENSITIVE_HEADER_NAMES.has(normalized) || isSensitiveName(normalized, undefined)
}

function isSensitiveName(name: string, exactNames: Set<string> | undefined): boolean {
  const normalized = name.toLowerCase()
  return (
    exactNames?.has(normalized) === true ||
    normalized.includes('api-key') ||
    normalized.includes('apikey') ||
    normalized.includes('secret') ||
    normalized.includes('token')
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function waitForServerListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('listening', handleListening)
      server.off('error', handleError)
    }
    const handleListening = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    server.once('listening', handleListening)
    server.once('error', handleError)
  })
}
