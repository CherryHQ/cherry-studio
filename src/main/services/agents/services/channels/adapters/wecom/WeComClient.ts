import { createHash, randomBytes } from 'node:crypto'

import { net } from 'electron'

import type {
  BizResponse,
  GetMcpConfigRequest,
  GetMcpConfigResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  McpConfigItem
} from './WeComTypes'

/** WeCom MCP config bootstrap endpoint. */
const DEFAULT_MCP_CONFIG_ENDPOINT = 'https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config'

/** Default tool-call timeout (ms). */
const DEFAULT_TIMEOUT_MS = 30_000

/** Extended timeout for media downloads (ms) — matches wecom-cli. */
const MEDIA_TIMEOUT_MS = 120_000

const MEDIA_METHODS = new Set(['get_msg_media'])

export interface WeComClientOptions {
  botId: string
  botSecret: string
  /** Identifier sent as `cli_version`; recognizable from server logs. */
  clientVersion?: string
  /** Override the bootstrap endpoint (used in tests). */
  endpoint?: string
}

export class WeComBusinessError extends Error {
  constructor(
    readonly errcode: number,
    message: string,
    readonly payload: BizResponse
  ) {
    super(message)
    this.name = 'WeComBusinessError'
  }
}

/**
 * Native Node port of wecom-cli's HTTP/JSON-RPC client.
 * Stateless per call apart from an in-memory URL cache populated by `bootstrap()`.
 */
export class WeComClient {
  private readonly botId: string
  private readonly botSecret: string
  private readonly clientVersion: string
  private readonly endpoint: string
  private categoryUrls = new Map<string, string>()

  constructor(opts: WeComClientOptions) {
    this.botId = opts.botId
    this.botSecret = opts.botSecret
    this.clientVersion = opts.clientVersion ?? 'CherryStudio/unknown'
    this.endpoint = opts.endpoint ?? DEFAULT_MCP_CONFIG_ENDPOINT
  }

  /**
   * Fetch the per-category MCP URLs and cache them. Validates credentials —
   * an invalid bot_id/secret pair will surface here as a business error.
   */
  async bootstrap(): Promise<McpConfigItem[]> {
    const time = Math.floor(Date.now() / 1000)
    const nonce = genReqId('mcp')
    const body: GetMcpConfigRequest = {
      bot_id: this.botId,
      time,
      nonce,
      signature: sign(this.botSecret, this.botId, time, nonce),
      bind_source: 1,
      cli_version: this.clientVersion
    }

    const response = await net.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': this.clientVersion },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`Bootstrap HTTP ${response.status}: ${await safeReadText(response)}`)
    }

    const data = (await response.json()) as GetMcpConfigResponse
    if (data.errcode !== 0) {
      throw new WeComBusinessError(
        data.errcode,
        `Bootstrap failed: ${data.errmsg ?? 'unknown error'} (errcode=${data.errcode})`,
        data as unknown as BizResponse
      )
    }

    const list = data.list ?? []
    this.categoryUrls.clear()
    for (const item of list) {
      if (item.biz_type && item.url) this.categoryUrls.set(item.biz_type, item.url)
    }
    return list
  }

  /** True iff `bootstrap()` has successfully populated at least one category URL. */
  isBootstrapped(): boolean {
    return this.categoryUrls.size > 0
  }

  /** Call a remote tool: `category`/`method` (e.g. 'msg' / 'send_message'). */
  async callTool<TArgs, TResult extends BizResponse>(category: string, method: string, args: TArgs): Promise<TResult> {
    const url = this.categoryUrls.get(category)
    if (!url) {
      throw new Error(`No MCP URL for category "${category}" — call bootstrap() first`)
    }

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: genReqId('mcp_rpc'),
      method: 'tools/call',
      params: { name: method, arguments: args }
    }

    const timeoutMs = MEDIA_METHODS.has(method) ? MEDIA_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await net.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': this.clientVersion },
        body: JSON.stringify(req),
        signal: controller.signal
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new Error(`WeCom RPC timed out after ${timeoutMs}ms (${category}.${method})`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error(`WeCom RPC HTTP ${response.status} (${category}.${method}): ${await safeReadText(response)}`)
    }

    const json = (await response.json()) as JsonRpcResponse

    if (json.error && json.error.code !== undefined && json.error.code !== 0) {
      throw new Error(`WeCom RPC error code=${json.error.code} (${category}.${method}): ${json.error.message ?? ''}`)
    }

    const result = json.result
    if (!result) {
      throw new Error(`WeCom RPC malformed response (${category}.${method}): missing result`)
    }
    if (result.isError) {
      throw new Error(`WeCom RPC tool error (${category}.${method}): ${JSON.stringify(result)}`)
    }

    const content = result.content
    if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text' || !content[0].text) {
      throw new Error(`WeCom RPC malformed content (${category}.${method})`)
    }

    let parsed: TResult
    try {
      parsed = JSON.parse(content[0].text) as TResult
    } catch {
      throw new Error(`WeCom RPC content is not JSON (${category}.${method})`)
    }

    const errcode = parsed.errcode
    if (typeof errcode === 'number' && errcode !== 0) {
      throw new WeComBusinessError(
        errcode,
        `${category}.${method} failed: ${parsed.errmsg ?? 'unknown error'} (errcode=${errcode})`,
        parsed
      )
    }

    return parsed
  }
}

/** `sha256_hex(secret + bot_id + time + nonce)` — see wecom-cli `src/mcp/config.rs:99`. */
export function sign(secret: string, botId: string, time: number, nonce: string): string {
  return createHash('sha256').update(`${secret}${botId}${time}${nonce}`).digest('hex')
}

/** Mirrors wecom-cli `gen_req_id`: `{prefix}_{ts_ms}_{8 hex chars}`. */
export function genReqId(prefix: string): string {
  const ts = Date.now()
  const hex = randomBytes(4).toString('hex')
  return `${prefix}_${ts}_${hex}`
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return '<unreadable body>'
  }
}
