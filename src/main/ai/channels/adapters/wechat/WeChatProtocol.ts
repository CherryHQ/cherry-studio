/**
 * WeChat iLink Bot protocol implementation.
 *
 * Inlined from @pinixai/weixin-bot to avoid the external dependency
 * and its fragile postinstall build step.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { loggerService } from '@logger'
import { net } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('WeChatProtocol')

// --------------- Types ---------------

interface BaseInfo {
  channel_version: string
}

enum MessageType {
  USER = 1,
  BOT = 2
}

enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2
}

enum MessageItemType {
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5
}

interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
}

interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

interface MessageItem {
  type: MessageItemType
  text_item?: { text: string }
  image_item?: ImageItem
  voice_item?: { text?: string }
  file_item?: { file_name?: string; file_size?: number; media?: CDNMedia; aeskey?: string }
  video_item?: unknown
  ref_msg?: unknown
}

interface WeixinMessage {
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
  _contextToken: string
  timestamp: Date
  /** Raw image items from WeChat CDN (encrypted, need download+decrypt). */
  _imageItems?: ImageItem[]
  /** Raw file items from WeChat CDN (encrypted, need download+decrypt). */
  _fileItems?: Array<{ file_name?: string; file_size?: number; media?: CDNMedia; aeskey?: string }>
}

// --------------- Zod response schemas ---------------

const ApiErrorBodySchema = z.object({
  ret: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional()
})

const WeixinMessageSchema = z.object({
  message_id: z.number(),
  from_user_id: z.string(),
  to_user_id: z.string(),
  client_id: z.string(),
  create_time_ms: z.number(),
  message_type: z.number(),
  message_state: z.number(),
  context_token: z.string(),
  item_list: z.array(z.unknown())
})

const GetUpdatesRespSchema = z.object({
  msgs: z.array(WeixinMessageSchema).default([]),
  get_updates_buf: z.string().default('')
})

const QrCodeResponseSchema = z.object({
  qrcode: z.string(),
  qrcode_img_content: z.string()
})

const QrStatusResponseSchema = z.object({
  status: z.enum(['wait', 'scaned', 'confirmed', 'expired']),
  bot_token: z.string().optional(),
  ilink_bot_id: z.string().optional(),
  ilink_user_id: z.string().optional(),
  baseurl: z.string().optional()
})

const GetConfigRespSchema = z.object({
  typing_ticket: z.string().optional()
})

const CredentialsSchema = z.object({
  token: z.string(),
  baseUrl: z.string(),
  accountId: z.string(),
  userId: z.string()
})

// --------------- Derived & request types ---------------

type QrCodeResponse = z.infer<typeof QrCodeResponseSchema>
type QrStatusResponse = z.infer<typeof QrStatusResponseSchema>
type GetConfigResp = z.infer<typeof GetConfigRespSchema>
type Credentials = z.infer<typeof CredentialsSchema>

interface SendTypingReq {
  ilink_user_id: string
  typing_ticket: string
  status: 1 | 2
  base_info: BaseInfo
}

// --------------- Constants ---------------

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const CHANNEL_VERSION = '1.0.0'
const QR_POLL_INTERVAL_MS = 2_000
const MAX_CONTEXT_TOKENS = 1000

// --------------- AES-128-ECB helpers ---------------

function aesEcbDecrypt(encrypted: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

function aesEcbEncrypt(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/**
 * Resolve the 16-byte AES key from an image_item.
 * Priority: image_item.aeskey (hex) > image_item.media.aes_key (base64)
 */
function resolveImageAesKey(item: ImageItem): Buffer | null {
  if (item.aeskey) {
    return Buffer.from(item.aeskey, 'hex')
  }
  if (item.media?.aes_key) {
    return parseAesKey(item.media.aes_key)
  }
  return null
}

// --------------- CDN download ---------------

async function cdnDownloadImage(item: ImageItem): Promise<Buffer | null> {
  const encryptQueryParam = item.media?.encrypt_query_param
  if (!encryptQueryParam) return null

  const aesKey = resolveImageAesKey(item)
  if (!aesKey) {
    logger.warn('Image item has encrypt_query_param but no AES key')
    return null
  }

  const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`
  const response = await net.fetch(url, { method: 'GET' })

  if (!response.ok) {
    return null
  }

  const encrypted = Buffer.from(await response.arrayBuffer())
  return aesEcbDecrypt(encrypted, aesKey)
}

type FileItem = NonNullable<MessageItem['file_item']>

/**
 * Parse a CDNMedia.aes_key into a raw 16-byte AES key.
 *
 * Two encodings exist in the wild (per Tencent/openclaw-weixin):
 *   - base64(raw 16 bytes)            → images
 *   - base64(32-char hex ASCII string) → file / voice / video
 *
 * In the second case, base64-decoding yields 32 ASCII hex chars which must
 * then be parsed as hex to recover the actual 16-byte key.
 */
function parseAesKey(aesKeyBase64: string): Buffer | null {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  logger.warn('Unexpected aes_key length after base64 decode', { length: decoded.length })
  return null
}

/**
 * Resolve the 16-byte AES key from a file_item.
 * Priority: file_item.aeskey (hex) > file_item.media.aes_key (base64, with hex re-decode for files)
 */
function resolveFileAesKey(item: FileItem): Buffer | null {
  if (item.aeskey) {
    return Buffer.from(item.aeskey, 'hex')
  }
  if (item.media?.aes_key) {
    return parseAesKey(item.media.aes_key)
  }
  return null
}

async function cdnDownloadFile(item: FileItem): Promise<Buffer | null> {
  const encryptQueryParam = item.media?.encrypt_query_param
  if (!encryptQueryParam) return null

  const aesKey = resolveFileAesKey(item)
  if (!aesKey) {
    logger.warn('File item has encrypt_query_param but no AES key')
    return null
  }

  const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`
  const response = await net.fetch(url, { method: 'GET' })

  if (!response.ok) {
    return null
  }

  const encrypted = Buffer.from(await response.arrayBuffer())
  return aesEcbDecrypt(encrypted, aesKey)
}

// --------------- CDN upload ---------------

const GetUploadUrlRespSchema = z.object({
  upload_param: z.string()
})

async function cdnUploadImage(
  baseUrl: string,
  token: string,
  uin: string,
  toUserId: string,
  imageData: Buffer
): Promise<{ downloadEncryptedQueryParam: string; aeskey: Buffer; ciphertextSize: number } | null> {
  const aeskey = randomBytes(16)
  const filekey = randomBytes(16).toString('hex')
  const md5Hash = await import('node:crypto').then((c) => c.createHash('md5').update(imageData).digest('hex'))

  // Step 1: get upload URL
  const raw = await apiFetch(
    baseUrl,
    '/ilink/bot/getuploadurl',
    {
      filekey,
      media_type: 1,
      to_user_id: toUserId,
      rawsize: imageData.length,
      rawfilemd5: md5Hash,
      filesize: imageData.length,
      no_need_thumb: true,
      aeskey: aeskey.toString('hex'),
      base_info: buildBaseInfo()
    },
    token,
    uin,
    15_000
  )
  const { upload_param } = GetUploadUrlRespSchema.parse(raw)

  // Step 2: encrypt and upload
  const ciphertext = aesEcbEncrypt(imageData, aeskey)
  const uploadUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(upload_param)}&filekey=${encodeURIComponent(filekey)}`
  const uploadResp = await net.fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(ciphertext)
  })

  if (!uploadResp.ok) {
    logger.error('CDN upload failed', { status: uploadResp.status })
    return null
  }

  const downloadEncryptedQueryParam = uploadResp.headers.get('x-encrypted-param')
  if (!downloadEncryptedQueryParam) {
    logger.error('CDN upload response missing x-encrypted-param header')
    return null
  }

  return { downloadEncryptedQueryParam, aeskey, ciphertextSize: ciphertext.length }
}

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

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION }
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text()
  const raw = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const body = ApiErrorBodySchema.safeParse(raw)
    const parsed = body.success ? body.data : {}
    throw new ApiError(parsed.errmsg ?? `${label} failed with HTTP ${response.status}`, {
      status: response.status,
      code: parsed.errcode,
      payload: raw
    })
  }

  const body = ApiErrorBodySchema.safeParse(raw)
  if (body.success && typeof body.data.ret === 'number' && body.data.ret !== 0) {
    throw new ApiError(body.data.errmsg ?? `${label} failed`, {
      status: response.status,
      code: body.data.errcode ?? body.data.ret,
      payload: raw
    })
  }

  return raw
}

function buildHeaders(token: string, uin: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${token}`,
    'X-WECHAT-UIN': uin
  }
}

async function apiFetch(
  baseUrlOrigin: string,
  endpoint: string,
  body: unknown,
  token: string,
  uin: string,
  timeoutMs = 40_000,
  signal?: AbortSignal
): Promise<unknown> {
  const url = `${baseUrlOrigin}${endpoint}`
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await net.fetch(url, {
    method: 'POST',
    headers: buildHeaders(token, uin),
    body: JSON.stringify(body),
    signal: requestSignal
  })

  return parseJsonResponse(response, endpoint)
}

async function apiGet(baseUrlOrigin: string, urlPath: string, headers: Record<string, string> = {}): Promise<unknown> {
  const url = `${baseUrlOrigin}${urlPath}`
  const response = await net.fetch(url, { method: 'GET', headers })
  return parseJsonResponse(response, urlPath)
}

async function getUpdates(
  baseUrl: string,
  token: string,
  uin: string,
  buf: string,
  signal?: AbortSignal
): Promise<{ msgs: WeixinMessage[]; get_updates_buf: string }> {
  const raw = await apiFetch(
    baseUrl,
    '/ilink/bot/getupdates',
    { get_updates_buf: buf, base_info: buildBaseInfo() },
    token,
    uin,
    40_000,
    signal
  )
  const parsed = GetUpdatesRespSchema.parse(raw)
  return { msgs: parsed.msgs as WeixinMessage[], get_updates_buf: parsed.get_updates_buf }
}

async function apiSendMessage(
  baseUrl: string,
  token: string,
  uin: string,
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
  await apiFetch(baseUrl, '/ilink/bot/sendmessage', { msg, base_info: buildBaseInfo() }, token, uin, 15_000)
}

async function apiGetConfig(
  baseUrl: string,
  token: string,
  uin: string,
  userId: string,
  contextToken: string
): Promise<GetConfigResp> {
  const raw = await apiFetch(
    baseUrl,
    '/ilink/bot/getconfig',
    { ilink_user_id: userId, context_token: contextToken, base_info: buildBaseInfo() },
    token,
    uin,
    15_000
  )
  return GetConfigRespSchema.parse(raw)
}

async function apiSendTyping(
  baseUrl: string,
  token: string,
  uin: string,
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
  await apiFetch(baseUrl, '/ilink/bot/sendtyping', body, token, uin, 15_000)
}

async function fetchQrCode(baseUrl: string): Promise<QrCodeResponse> {
  const raw = await apiGet(baseUrl, '/ilink/bot/get_bot_qrcode?bot_type=3')
  return QrCodeResponseSchema.parse(raw)
}

async function pollQrStatus(baseUrl: string, qrcode: string): Promise<QrStatusResponse> {
  const raw = await apiGet(baseUrl, `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
    'iLink-App-ClientVersion': '1'
  })
  return QrStatusResponseSchema.parse(raw)
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

async function loadCredentials(tokenPath: string): Promise<Credentials | undefined> {
  try {
    const raw = await readFile(tokenPath, 'utf8')
    const result = CredentialsSchema.safeParse(JSON.parse(raw))
    if (!result.success) {
      throw new Error(`Invalid credentials format in ${tokenPath}`)
    }
    return result.data
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
  signal?: AbortSignal
  onQrUrl?: (url: string) => void
}

/** Maximum number of expired QR codes before giving up. */
const MAX_QR_RETRIES = 3

async function loginFlow(options: LoginOptions): Promise<Credentials> {
  if (!options.force) {
    const existing = await loadCredentials(options.tokenPath)
    if (existing) return existing
  }

  let qrRetries = 0

  while (qrRetries < MAX_QR_RETRIES) {
    if (options.signal?.aborted) {
      throw new Error('Login cancelled')
    }

    const qr = await fetchQrCode(options.baseUrl)
    options.onQrUrl?.(qr.qrcode_img_content)
    logger.info('QR code generated, waiting for scan', { attempt: qrRetries + 1, maxAttempts: MAX_QR_RETRIES })

    let lastStatus: string | undefined

    for (;;) {
      if (options.signal?.aborted) {
        throw new Error('Login cancelled')
      }

      const status = await pollQrStatus(options.baseUrl, qr.qrcode)

      if (status.status !== lastStatus) {
        if (status.status === 'scaned') {
          logger.info('QR code scanned, waiting for confirmation')
        } else if (status.status === 'confirmed') {
          logger.info('Login confirmed')
        } else if (status.status === 'expired') {
          logger.info('QR code expired', { attempt: qrRetries + 1, maxAttempts: MAX_QR_RETRIES })
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

    qrRetries++
  }

  throw new Error(`QR login failed after ${MAX_QR_RETRIES} expired QR codes. Use config tool to reconnect.`)
}

// --------------- WeixinBot ---------------

type MessageHandler = (msg: IncomingMessage) => void | Promise<void>

export interface WeixinBotOptions {
  baseUrl?: string
  tokenPath?: string
  onError?: (error: unknown) => void
  onQrUrl?: (url: string) => void
}

/** Normalize a base URL to origin form (no trailing slash). */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export class WeixinBot {
  private baseUrl: string
  private readonly uin: string
  private readonly tokenPath?: string
  private readonly contextTokenPath?: string
  private readonly onErrorCallback?: (error: unknown) => void
  private readonly onQrUrlCallback?: (url: string) => void
  private readonly handlers: MessageHandler[] = []
  private readonly contextTokens = new Map<string, string>()
  private credentials?: Credentials
  private cursor = ''
  private stopped = false
  private currentPollController: AbortController | null = null
  private loginAbort: AbortController | null = null
  private runPromise: Promise<void> | null = null

  constructor(options: WeixinBotOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL)
    this.uin = Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64')
    this.tokenPath = options.tokenPath
    this.contextTokenPath = options.tokenPath ? options.tokenPath.replace(/\.json$/, '.context-tokens.json') : undefined
    this.onErrorCallback = options.onError
    this.onQrUrlCallback = options.onQrUrl
    this.restoreContextTokens()
  }

  async hasCredentials(): Promise<boolean> {
    if (!this.tokenPath) return false
    const creds = await loadCredentials(this.tokenPath)
    return creds !== undefined
  }

  async login(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<Credentials> {
    const previousToken = this.credentials?.token
    // Use provided signal or create an internal one that stop() can cancel
    this.loginAbort = new AbortController()
    const signal = options.signal ? AbortSignal.any([options.signal, this.loginAbort.signal]) : this.loginAbort.signal
    const credentials = await loginFlow({
      baseUrl: this.baseUrl,
      tokenPath: this.tokenPath!,
      force: options.force,
      signal,
      onQrUrl: this.onQrUrlCallback
    })
    this.loginAbort = null

    this.credentials = credentials
    this.baseUrl = normalizeBaseUrl(credentials.baseUrl)

    if (previousToken && previousToken !== credentials.token) {
      this.cursor = ''
      this.contextTokens.clear()
      this.clearPersistedContextTokens()
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
    this.persistContextTokens()
    await this.sendText(message.userId, text, message._contextToken)
    this.stopTyping(message.userId).catch(() => {})
  }

  async sendTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) return

    const credentials = await this.ensureCredentials()
    const config = await apiGetConfig(this.baseUrl, credentials.token, this.uin, userId, contextToken)
    if (!config.typing_ticket) return

    await apiSendTyping(this.baseUrl, credentials.token, this.uin, userId, config.typing_ticket, 1)
  }

  async stopTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) return

    const credentials = await this.ensureCredentials()
    const config = await apiGetConfig(this.baseUrl, credentials.token, this.uin, userId, contextToken)
    if (!config.typing_ticket) return

    await apiSendTyping(this.baseUrl, credentials.token, this.uin, userId, config.typing_ticket, 2)
  }

  async send(userId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) {
      logger.warn('No cached context token, sending without context', { userId })
    }

    await this.sendText(userId, text, contextToken ?? '')
  }

  /**
   * Download and decrypt an image from WeChat CDN.
   * Returns a data URL (data:<mime>;base64,...) or null on failure.
   * Format conversion (to PNG) is handled downstream by ClaudeCodeService.
   */
  async downloadImage(imageItem: ImageItem): Promise<string | null> {
    try {
      const data = await cdnDownloadImage(imageItem)
      if (!data) return null

      const mime = detectImageMime(data)
      return `data:${mime};base64,${data.toString('base64')}`
    } catch (error) {
      logger.error('Failed to download WeChat image', error instanceof Error ? error : { error: String(error) })
      return null
    }
  }

  /**
   * Download and decrypt a file from WeChat CDN.
   * Returns { data: Buffer, filename: string } or null on failure.
   */
  async downloadFile(fileItem: FileItem): Promise<{ data: Buffer; filename: string } | null> {
    try {
      const data = await cdnDownloadFile(fileItem)
      if (!data) return null
      return { data, filename: fileItem.file_name ?? 'file' }
    } catch (error) {
      logger.error('Failed to download WeChat file', error instanceof Error ? error : { error: String(error) })
      return null
    }
  }

  /**
   * Send an image to a user by uploading to WeChat CDN.
   */
  async sendImage(userId: string, imageData: Buffer): Promise<void> {
    const contextToken = this.contextTokens.get(userId)
    if (!contextToken) {
      logger.warn('No cached context token for sendImage, sending without context', { userId })
    }

    const credentials = await this.ensureCredentials()
    const uploaded = await cdnUploadImage(this.baseUrl, credentials.token, this.uin, userId, imageData)
    if (!uploaded) {
      throw new Error('Failed to upload image to WeChat CDN')
    }

    const msg = {
      from_user_id: '',
      to_user_id: userId,
      client_id: randomUUID(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken ?? '',
      item_list: [
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: uploaded.downloadEncryptedQueryParam,
              aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
              encrypt_type: 1
            },
            mid_size: uploaded.ciphertextSize
          }
        }
      ]
    }

    await apiSendMessage(this.baseUrl, credentials.token, this.uin, msg)
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
    this.loginAbort?.abort()
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
          this.uin,
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
      this.baseUrl = normalizeBaseUrl(stored.baseUrl)
      return stored
    }

    return this.login()
  }

  private async sendText(userId: string, text: string, contextToken: string): Promise<void> {
    if (text.length === 0) {
      throw new Error('Message text cannot be empty.')
    }

    const credentials = await this.ensureCredentials()
    await apiSendMessage(this.baseUrl, credentials.token, this.uin, buildTextMessage(userId, contextToken, text))
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
      // Evict oldest entry when map exceeds max size
      if (this.contextTokens.size >= MAX_CONTEXT_TOKENS && !this.contextTokens.has(userId)) {
        const oldest = this.contextTokens.keys().next().value
        if (oldest !== undefined) this.contextTokens.delete(oldest)
      }
      this.contextTokens.set(userId, message.context_token)
      this.persistContextTokens()
    }
  }

  private toIncomingMessage(message: WeixinMessage): IncomingMessage | null {
    if (message.message_type !== MessageType.USER) return null

    const imageItems = message.item_list
      .filter((item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param)
      .map((item) => item.image_item!)

    const fileItems = message.item_list
      .filter((item) => item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param)
      .map((item) => item.file_item!)

    return {
      userId: message.from_user_id,
      text: extractText(message.item_list),
      type: detectType(message.item_list),
      _contextToken: message.context_token,
      timestamp: new Date(message.create_time_ms),
      _imageItems: imageItems.length > 0 ? imageItems : undefined,
      _fileItems: fileItems.length > 0 ? fileItems : undefined
    }
  }

  private persistContextTokens(): void {
    if (!this.contextTokenPath) return
    try {
      const tokens: Record<string, string> = {}
      for (const [k, v] of this.contextTokens) {
        tokens[k] = v
      }
      writeFile(this.contextTokenPath, JSON.stringify(tokens), { mode: 0o600 }).catch((err) => {
        logger.warn('Failed to persist context tokens', { error: err instanceof Error ? err.message : String(err) })
      })
    } catch (err) {
      logger.warn('Failed to persist context tokens', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private restoreContextTokens(): void {
    if (!this.contextTokenPath) return
    try {
      if (!fs.existsSync(this.contextTokenPath)) return
      const raw = fs.readFileSync(this.contextTokenPath, 'utf8')
      const tokens = JSON.parse(raw) as Record<string, string>
      let count = 0
      for (const [userId, token] of Object.entries(tokens)) {
        if (typeof token === 'string' && token) {
          this.contextTokens.set(userId, token)
          count++
        }
      }
      if (count > 0) {
        logger.info('Restored context tokens from disk', { count })
      }
    } catch (err) {
      logger.warn('Failed to restore context tokens', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private clearPersistedContextTokens(): void {
    if (!this.contextTokenPath) return
    rm(this.contextTokenPath, { force: true }).catch(() => {})
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
          return ''
        case MessageItemType.VOICE:
          return item.voice_item?.text ?? '[voice]'
        case MessageItemType.FILE:
          return ''
        case MessageItemType.VIDEO:
          return '[video]'
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

function detectImageMime(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif'
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === -14
}
