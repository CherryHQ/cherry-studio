import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { observabilitySinks } from '../../sinks/ObservabilitySinkRegistry'
import { ClaudeCodeOtlpAdapter, type ClaudeCodeTraceContext } from './ClaudeCodeOtlpAdapter'

const logger = loggerService.withContext('ClaudeCodeTraceBridgeService')
const MAX_BODY_BYTES = 10 * 1024 * 1024
const TRACE_CONTEXT_TTL_MS = 30 * 60 * 1000

interface TraceContextEntry {
  context: ClaudeCodeTraceContext
  expiresAt: number
}

@Injectable('ClaudeCodeTraceBridgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['SpanCacheService'])
export class ClaudeCodeTraceBridgeService extends BaseService implements Activatable {
  private server?: Server
  private endpoint?: string
  private startPromise?: Promise<string>
  private readonly traceContexts = new Map<string, TraceContextEntry>()

  protected async onReady(): Promise<void> {
    const enabled = application.get('PreferenceService').get('app.developer_mode.enabled')
    logger.info(
      `Developer mode is ${enabled ? 'enabled' : 'disabled'}, Claude Code trace bridge ${
        enabled ? 'activated' : 'skipped'
      }`
    )
    if (enabled) {
      await this.activate()
    }
  }

  async onActivate(): Promise<void> {
    // Collector binding is intentionally lazy; activation only marks trace mode as available.
  }

  async onDeactivate(): Promise<void> {
    this.traceContexts.clear()
    await this.stopServer()
  }

  isTraceModeEnabled(): boolean {
    return this.isActivated
  }

  async prepareTrace(context: ClaudeCodeTraceContext): Promise<Record<string, string> | undefined> {
    if (!this.isActivated) return undefined

    if (!isTraceId(context.traceId) || !isSpanId(context.rootSpanId)) {
      logger.warn('Skipping Claude Code trace env for invalid trace context', {
        traceId: context.traceId,
        rootSpanId: context.rootSpanId
      })
      return undefined
    }

    const normalizedContext: ClaudeCodeTraceContext = {
      ...context,
      traceId: context.traceId.toLowerCase(),
      rootSpanId: context.rootSpanId.toLowerCase()
    }

    this.setTraceContext(normalizedContext)
    observabilitySinks.registerTraceMeta(normalizedContext.traceId, {
      topicId: normalizedContext.topicId,
      modelName: normalizedContext.modelName
    })

    const endpoint = await this.ensureServer()
    // INTENTIONAL DEV-ONLY BEHAVIOR. This whole bridge only runs when developer_mode is
    // enabled (see onReady), and these flags ask Claude Code to emit verbose telemetry —
    // user prompts (OTEL_LOG_USER_PROMPTS), tool details/content, and raw API request/response
    // bodies (OTEL_LOG_RAW_API_BODIES). Those payloads land in span attributes that
    // SpanCacheService persists as plaintext JSONL trace files on disk, so they may contain
    // secrets (e.g. authorization headers, API keys embedded in raw bodies). We do NOT redact
    // here: redaction would require parsing arbitrary OTLP attribute structures across the
    // ingest path and risk dropping legitimate trace data. The accepted tradeoff (local-only,
    // developer-gated capture) needs a threat-model decision — see docs/references/ai/observability.md.
    return {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      ENABLE_BETA_TRACING_DETAILED: '1',
      BETA_TRACING_ENDPOINT: endpoint,
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
      OTEL_TRACES_EXPORT_INTERVAL: '1000',
      OTEL_LOGS_EXPORT_INTERVAL: '1000',
      OTEL_LOG_USER_PROMPTS: '1',
      OTEL_LOG_TOOL_DETAILS: '1',
      OTEL_LOG_TOOL_CONTENT: '1',
      OTEL_LOG_RAW_API_BODIES: '1',
      TRACEPARENT: `00-${normalizedContext.traceId}-${normalizedContext.rootSpanId}-01`
    }
  }

  private async ensureServer(): Promise<string> {
    if (this.endpoint) return this.endpoint
    if (this.startPromise) return this.startPromise

    this.startPromise = new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      const fail = (error: Error) => {
        this.startPromise = undefined
        reject(error)
      }

      server.once('error', fail)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail)
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          fail(new Error('Claude Code trace bridge did not bind a TCP port'))
          return
        }
        this.server = server
        this.endpoint = `http://127.0.0.1:${address.port}`
        logger.info('Claude Code trace bridge listening', { endpoint: this.endpoint })
        resolve(this.endpoint)
      })
    })

    return this.startPromise
  }

  private async stopServer(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.endpoint = undefined
    this.startPromise = undefined
    if (!server) return

    await new Promise<void>((resolve) => {
      server.close((error) => {
        if (error) logger.warn('Failed to close Claude Code trace bridge', { error })
        resolve()
      })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.respond(res, 405)
      return
    }

    const pathname = this.getPathname(req)
    if (pathname !== '/v1/traces' && pathname !== '/v1/logs') {
      this.respond(res, 404)
      return
    }

    if (!isJsonContentType(req)) {
      this.respond(res, 415)
      return
    }

    try {
      const payload = await readJsonBody(req)
      observabilitySinks.writeRawOtlpPayload(pathname, payload)
      if (pathname === '/v1/traces') {
        this.ingestTraces(payload)
        this.respond(res, 200)
        return
      }
      if (pathname === '/v1/logs') {
        this.ingestLogs(payload)
        this.respond(res, 200)
        return
      }
    } catch (error) {
      logger.warn('Failed to ingest Claude Code telemetry payload', { path: req.url, error })
      this.respond(res, error instanceof UnsupportedContentEncodingError ? 415 : 400)
    }
  }

  private ingestTraces(payload: unknown): void {
    const spans = ClaudeCodeOtlpAdapter.spansFromPayload(payload, (traceId) => this.getTraceContext(traceId))
    for (const span of spans) {
      observabilitySinks.writeSpanEntity(span)
    }
  }

  private ingestLogs(payload: unknown): void {
    const logEvents = ClaudeCodeOtlpAdapter.logEventsFromPayload(payload)
    for (const logEvent of logEvents) {
      observabilitySinks.writeSpanEvent(logEvent.traceId, logEvent.spanId, logEvent.event)
    }
  }

  private respond(res: ServerResponse, statusCode: number): void {
    res.writeHead(statusCode, { 'content-type': 'application/json' })
    res.end('{}')
  }

  private setTraceContext(context: ClaudeCodeTraceContext): void {
    const now = Date.now()
    this.pruneTraceContexts(now)
    this.traceContexts.set(context.traceId, {
      context,
      expiresAt: now + TRACE_CONTEXT_TTL_MS
    })
  }

  private getTraceContext(traceId: string): ClaudeCodeTraceContext | undefined {
    const normalizedTraceId = traceId.toLowerCase()
    const item = this.traceContexts.get(normalizedTraceId)
    if (!item) return undefined

    if (Date.now() > item.expiresAt) {
      this.traceContexts.delete(normalizedTraceId)
      return undefined
    }

    return item.context
  }

  private pruneTraceContexts(now = Date.now()): void {
    for (const [traceId, item] of this.traceContexts) {
      if (now > item.expiresAt) {
        this.traceContexts.delete(traceId)
      }
    }
  }

  private getPathname(req: IncomingMessage): string {
    return new URL(req.url ?? '/', this.endpoint ?? 'http://127.0.0.1').pathname
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('OTLP payload too large')
    }
    chunks.push(buffer)
  }

  let body = Buffer.concat(chunks)
  const encoding = getHeaderValue(req.headers['content-encoding']).toLowerCase()
  if (encoding === 'gzip') {
    try {
      // Cap the decompressed output so a gzip bomb can't allocate gigabytes before any size check.
      body = gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES })
    } catch (error) {
      // zlib raises a RangeError (ERR_BUFFER_TOO_LARGE) when maxOutputLength is exceeded.
      if (error instanceof RangeError) {
        throw new Error('OTLP payload too large after gzip decompression')
      }
      throw error
    }
  } else if (encoding !== '' && encoding !== 'identity') {
    throw new UnsupportedContentEncodingError(`Unsupported OTLP content encoding: ${encoding}`)
  }

  const text = body.toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

function isJsonContentType(req: IncomingMessage): boolean {
  return getHeaderValue(req.headers['content-type']).toLowerCase().includes('application/json')
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',')
  return value ?? ''
}

function isTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value) && value !== '00000000000000000000000000000000'
}

function isSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value) && value !== '0000000000000000'
}

class UnsupportedContentEncodingError extends Error {}
