/**
 * WeChat iLink Bot protocol implementation.
 *
 * Inlined from @pinixai/weixin-bot to avoid the external dependency
 * and its fragile postinstall build step.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('WeChatProtocol')

// --------------- Types ---------------

export interface BaseInfo {
  channel_version: string
}

export enum MessageType {
  USER = 1,
  BOT = 2
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2
}

export enum MessageItemType {
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5
}

export interface TextItem {
  text: string
}

export interface CDNMedia {
  encrypt_query_param: string
  aes_key: string
  encrypt_type?: 0 | 1
}

export interface ImageItem {
  media: CDNMedia
  aeskey?: string
  url?: string
  mid_size?: string | number
  thumb_size?: string | number
  thumb_height?: number
  thumb_width?: number
  hd_size?: string | number
}

export interface VoiceItem {
  media: CDNMedia
  encode_type?: number
  text?: string
  playtime?: number
}

export interface FileItem {
  media: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export interface VideoItem {
  media: CDNMedia
  video_size?: string | number
  play_length?: number
  thumb_media?: CDNMedia
}

export interface RefMessage {
  title?: string
  message_item?: MessageItem
}

export interface MessageItem {
  type: MessageItemType
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
  ref_msg?: RefMessage
}

export interface WeixinMessage {
  message_id: number
  from_user_id: string
  to_user_id: string
  client_id: string
  create_time_ms: number
  message_type: MessageType
  message_state: MessageState
  context_token: string
  item_list: MessageItem[]
}

export interface IncomingMessage {
  userId: string
  text: string
  type: 'text' | 'image' | 'voice' | 'file' | 'video'
  raw: WeixinMessage
  _contextToken: string
  timestamp: Date
}

interface GetUpdatesResp {
  ret: number
  msgs: WeixinMessage[]
  get_updates_buf: string
  longpolling_timeout_ms?: number
  errcode?: number
  errmsg?: string
}

interface QrCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

interface QrStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired'
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
}

interface GetConfigResp {
  typing_ticket?: string
  ret?: number
  errcode?: number
  errmsg?: string
}

interface SendTypingReq {
  ilink_user_id: string
  typing_ticket: string
  status: 1 | 2
  base_info: BaseInfo
}

interface Credentials {
  token: string
  baseUrl: string
  accountId: string
  userId: string
}

// --------------- Constants ---------------

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CHANNEL_VERSION = '1.0.0'
const QR_POLL_INTERVAL_MS = 2_000

// --------------- API helpers ---------------

class ApiError extends Error {
  readonly status: number
  readonly code?: number
  readonly payload?: unknown

  constructor(message: string, options: { status: number; code?: number; payload?: unknown }) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.payload = options.payload
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION }
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
    const message = (payload as { errmsg?: string } | null)?.errmsg ?? `${label} failed with HTTP ${response.status}`
    throw new ApiError(message, {
      status: response.status,
      code: (payload as { errcode?: number } | null)?.errcode,
      payload
    })
  }

  if (typeof (payload as { ret?: number } | null)?.ret === 'number' && (payload as { ret: number }).ret !== 0) {
    const body = payload as { errcode?: number; errmsg?: string; ret: number }
    throw new ApiError(body.errmsg ?? `${label} failed`, {
      status: response.status,
      code: body.errcode ?? body.ret,
      payload
    })
  }

  return payload
}

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function buildHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${token}`,
    'X-WECHAT-UIN': randomWechatUin()
  }
}

async function apiFetch<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  token: string,
  timeoutMs = 40_000,
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(endpoint, `${normalizeBaseUrl(baseUrl)}/`)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await net.fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
    signal: requestSignal
  })

  return parseJsonResponse<T>(response, endpoint)
}

async function apiGet<T>(baseUrl: string, urlPath: string, headers: Record<string, string> = {}): Promise<T> {
  const url = new URL(urlPath, `${normalizeBaseUrl(baseUrl)}/`)
  const response = await fetch(url, { method: 'GET', headers })
  return parseJsonResponse<T>(response, urlPath)
}

async function getUpdates(baseUrl: string, token: string, buf: string, signal?: AbortSignal): Promise<GetUpdatesResp> {
  return apiFetch<GetUpdatesResp>(
    baseUrl,
    '/ilink/bot/getupdates',
    { get_updates_buf: buf, base_info: buildBaseInfo() },
    token,
    40_000,
    signal
  )
}

async function apiSendMessage(
  baseUrl: string,
  token: string,
  msg: {
    from_user_id: string
    to_user_id: string
    client_id: string
    message_type: MessageType
    message_state: MessageState
    context_token: string
    item_list: MessageItem[]
  }
): Promise<void> {
  await apiFetch(baseUrl, '/ilink/bot/sendmessage', { msg, base_info: buildBaseInfo() }, token, 15_000)
}

async function apiGetConfig(
  baseUrl: string,
  token: string,
  userId: string,
  contextToken: string
): Promise<GetConfigResp> {
  return apiFetch<GetConfigResp>(
    baseUrl,
    '/ilink/bot/getconfig',
    { ilink_user_id: userId, context_token: contextToken, base_info: buildBaseInfo() },
    token,
    15_000
  )
}

async function apiSendTyping(
  baseUrl: string,
  token: string,
  userId: string,
  ticket: string,
  status: SendTypingReq['status']
): Promise<void> {
  const body: SendTypingReq = {
    ilink_user_id: userId,
    typing_ticket: ticket,
    status,
    base_info: buildBaseInfo()
  }
  await apiFetch(baseUrl, '/ilink/bot/sendtyping', body, token, 15_000)
}

async function fetchQrCode(baseUrl: string): Promise<QrCodeResponse> {
  return apiGet<QrCodeResponse>(baseUrl, '/ilink/bot/get_bot_qrcode?bot_type=3')
}

async function pollQrStatus(baseUrl: string, qrcode: string): Promise<QrStatusResponse> {
  return apiGet<QrStatusResponse>(baseUrl, `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
    'iLink-App-ClientVersion': '1'
  })
}

function buildTextMessage(
  userId: string,
  contextToken: string,
  text: string
): {
  from_user_id: string
  to_user_id: string
  client_id: string
  message_type: MessageType
  message_state: MessageState
  context_token: string
  item_list: MessageItem[]
} {
  return {
    from_user_id: '',
    to_user_id: userId,
    client_id: randomUUID(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    context_token: contextToken,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text } }]
  }
}

// --------------- Auth ---------------

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.token === 'string' &&
    typeof c.baseUrl === 'string' &&
    typeof c.accountId === 'string' &&
    typeof c.userId === 'string'
  )
}

async function loadCredentials(tokenPath: string): Promise<Credentials | undefined> {
  try {
    const raw = await readFile(tokenPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isCredentials(parsed)) {
      throw new Error(`Invalid credentials format in ${tokenPath}`)
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function saveCredentials(credentials: Credentials, tokenPath: string): Promise<void> {
  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 })
  await writeFile(tokenPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  await chmod(tokenPath, 0o600)
}

async function clearCredentials(tokenPath: string): Promise<void> {
  await rm(tokenPath, { force: true })
}

interface LoginOptions {
  baseUrl: string
  tokenPath: string
  force?: boolean
  onQrUrl?: (url: string) => void
}

async function login(options: LoginOptions): Promise<Credentials> {
  if (!options.force) {
    const existing = await loadCredentials(options.tokenPath)
    if (existing) return existing
  }

  for (;;) {
    const qr = await fetchQrCode(options.baseUrl)
    options.onQrUrl?.(qr.qrcode_img_content)
    logger.info('QR code generated, waiting for scan')

    let lastStatus: string | undefined

    for (;;) {
      const status = await pollQrStatus(options.baseUrl, qr.qrcode)

      if (status.status !== lastStatus) {
        if (status.status === 'scaned') {
          logger.info('QR code scanned, waiting for confirmation')
        } else if (status.status === 'confirmed') {
          logger.info('Login confirmed')
        } else if (status.status === 'expired') {
          logger.info('QR code expired, requesting a new one')
        }
        lastStatus = status.status
      }

      if (status.status === 'confirmed') {
        if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
          throw new Error('QR login confirmed, but the API did not return bot credentials')
        }

        const credentials: Credentials = {
          token: status.bot_token,
          baseUrl: status.baseurl ?? options.baseUrl,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id
        }
        await saveCredentials(credentials, options.tokenPath)
        return credentials
      }

      if (status.status === 'expired') break

      await delay(QR_POLL_INTERVAL_MS)
    }
  }
}

// --------------- WeixinBot ---------------

type MessageHandler = (msg: IncomingMessage) => void | Promise<void>

export interface WeixinBotOptions {
  baseUrl?: string
  tokenPath?: string
  onError?: (error: unknown) => void
  onQrUrl?: (url: string) => void
}

export class WeixinBot {
  private baseUrl: string
  private readonly tokenPath?: string
  private readonly onErrorCallback?: (error: unknown) => void
  private readonly onQrUrlCallback?: (url: string) => void
  private readonly handlers: MessageHandler[] = []
  private readonly contextTokens = new Map<string, string>()
  private credentials?: Credentials
  private cursor = ''
  private stopped = false
  private currentPollController: AbortController | null = null
  private runPromise: Promise<void> | null = null

  constructor(options: WeixinBotOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.tokenPath = options.tokenPath
    this.onErrorCallback = options.onError
    this.onQrUrlCallback = options.onQrUrl
  }

  async login(options: { force?: boolean } = {}): Promise<Credentials> {
    const previousToken = this.credentials?.token
    const credentials = await login({
      baseUrl: this.baseUrl,
      tokenPath: this.tokenPath!,
      force: options.force,
      onQrUrl: this.onQrUrlCallback
    })

    this.credentials = credentials
    this.baseUrl = credentials.baseUrl

    if (previousToken && previousToken !== credentials.token) {
      this.cursor = ''
      this.contextTokens.clear()
    }

    logger.info('Logged in', { userId: credentials.userId })
    return credentials
  }

  onMessage(handler: MessageHandler): this {
    this.handlers.push(handler)
    return this
  }

  async reply(message: IncomingMessage, text: string): Promise<void> {
    this.contextTokens.set(message.userId, message._contextToken)
    await this.sendText(message.userId, text, message._contextToken)
    this.stopTyping(message.userId).catch(() => {})
  }

  async sendTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) {
      throw new Error(`No cached context token for user ${userId}. Reply to an incoming message first.`)
    }

    const credentials = await this.ensureCredentials()
    const config = await apiGetConfig(this.baseUrl, credentials.token, userId, contextToken)
    if (!config.typing_ticket) return

    await apiSendTyping(this.baseUrl, credentials.token, userId, config.typing_ticket, 1)
  }

  async stopTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) return

    const credentials = await this.ensureCredentials()
    const config = await apiGetConfig(this.baseUrl, credentials.token, userId, contextToken)
    if (!config.typing_ticket) return

    await apiSendTyping(this.baseUrl, credentials.token, userId, config.typing_ticket, 2)
  }

  async send(userId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) {
      throw new Error(`No cached context token for user ${userId}. Reply to an incoming message first.`)
    }

    await this.sendText(userId, text, contextToken)
  }

  async run(): Promise<void> {
    if (this.runPromise) return this.runPromise

    this.stopped = false
    this.runPromise = this.runLoop()

    try {
      await this.runPromise
    } finally {
      this.runPromise = null
      this.currentPollController = null
    }
  }

  stop(): void {
    this.stopped = true
    this.currentPollController?.abort()
  }

  private async runLoop(): Promise<void> {
    await this.ensureCredentials()
    logger.info('Long-poll loop started')
    let retryDelayMs = 1_000

    while (!this.stopped) {
      try {
        const credentials = await this.ensureCredentials()
        this.currentPollController = new AbortController()
        const updates = await getUpdates(
          this.baseUrl,
          credentials.token,
          this.cursor,
          this.currentPollController.signal
        )

        this.currentPollController = null
        this.cursor = updates.get_updates_buf || this.cursor
        retryDelayMs = 1_000

        for (const raw of updates.msgs ?? []) {
          this.rememberContext(raw)
          const incoming = this.toIncomingMessage(raw)
          if (incoming) {
            await this.dispatchMessage(incoming)
          }
        }
      } catch (error) {
        this.currentPollController = null

        if (this.stopped && isAbortError(error)) break

        if (isSessionExpired(error)) {
          logger.info('Session expired, re-authenticating')
          this.credentials = undefined
          this.cursor = ''
          this.contextTokens.clear()

          try {
            await clearCredentials(this.tokenPath!)
            await this.login({ force: true })
            retryDelayMs = 1_000
            continue
          } catch (loginError) {
            this.reportError(loginError)
          }
        } else {
          this.reportError(error)
        }

        await delay(retryDelayMs)
        retryDelayMs = Math.min(retryDelayMs * 2, 10_000)
      }
    }

    logger.info('Long-poll loop stopped')
  }

  private async ensureCredentials(): Promise<Credentials> {
    if (this.credentials) return this.credentials

    const stored = await loadCredentials(this.tokenPath!)
    if (stored) {
      this.credentials = stored
      this.baseUrl = stored.baseUrl
      return stored
    }

    return this.login()
  }

  private async sendText(userId: string, text: string, contextToken: string): Promise<void> {
    if (text.length === 0) {
      throw new Error('Message text cannot be empty.')
    }

    const credentials = await this.ensureCredentials()
    await apiSendMessage(this.baseUrl, credentials.token, buildTextMessage(userId, contextToken, text))
  }

  private async dispatchMessage(message: IncomingMessage): Promise<void> {
    if (this.handlers.length === 0) return

    const results = await Promise.allSettled(this.handlers.map(async (handler) => handler(message)))
    for (const result of results) {
      if (result.status === 'rejected') {
        this.reportError(result.reason)
      }
    }
  }

  private rememberContext(message: WeixinMessage): void {
    const userId = message.message_type === MessageType.USER ? message.from_user_id : message.to_user_id
    if (userId && message.context_token) {
      this.contextTokens.set(userId, message.context_token)
    }
  }

  private toIncomingMessage(message: WeixinMessage): IncomingMessage | null {
    if (message.message_type !== MessageType.USER) return null

    return {
      userId: message.from_user_id,
      text: extractText(message.item_list),
      type: detectType(message.item_list),
      raw: message,
      _contextToken: message.context_token,
      timestamp: new Date(message.create_time_ms)
    }
  }

  private reportError(error: unknown): void {
    logger.error('Bot error', error instanceof Error ? error : { error: String(error) })
    this.onErrorCallback?.(error)
  }
}

// --------------- Helpers ---------------

function detectType(items: MessageItem[]): IncomingMessage['type'] {
  const first = items[0]
  switch (first?.type) {
    case MessageItemType.IMAGE:
      return 'image'
    case MessageItemType.VOICE:
      return 'voice'
    case MessageItemType.FILE:
      return 'file'
    case MessageItemType.VIDEO:
      return 'video'
    default:
      return 'text'
  }
}

function extractText(items: MessageItem[]): string {
  return items
    .map((item) => {
      switch (item.type) {
        case MessageItemType.TEXT:
          return item.text_item?.text ?? ''
        case MessageItemType.IMAGE:
          return item.image_item?.url ?? '[image]'
        case MessageItemType.VOICE:
          return item.voice_item?.text ?? '[voice]'
        case MessageItemType.FILE:
          return item.file_item?.file_name ?? '[file]'
        case MessageItemType.VIDEO:
          return '[video]'
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === -14
}
