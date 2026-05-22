/**
 * DingTalk HTTP helpers used by the channel adapter.
 *
 * Covers:
 *   - access token cache (`POST /v1.0/oauth2/accessToken`)
 *   - reply via session webhook (per-message URL, valid ~5 min)
 *   - proactive group/DM send (`/v1.0/robot/groupMessages/send`, `/oToMessages/batchSend`)
 *   - media download (`/v1.0/robot/messageFiles/download` -> follow downloadUrl)
 *
 * The Stream/WebSocket inbound path lives in DingTalkAdapter via `DWClient`
 * from the `dingtalk-stream` package.
 */
import { net } from 'electron'

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken'
const GROUP_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
const P2P_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend'
const MEDIA_DOWNLOAD_URL = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download'

const TOKEN_REFRESH_LEAD_MS = 60_000

export interface DingTalkClientOptions {
  clientId: string
  clientSecret: string
}

export interface SessionTextPayload {
  msgtype: 'text'
  text: { content: string }
}

export interface MediaDownloadResult {
  /** Raw bytes of the downloaded media. */
  buffer: Buffer
  /** MIME type from the second-hop URL response, or `application/octet-stream`. */
  contentType: string
}

interface TokenCache {
  accessToken: string
  expiresAt: number
}

export class DingTalkApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | number
  ) {
    super(message)
    this.name = 'DingTalkApiError'
  }
}

export class DingTalkClient {
  private readonly clientId: string
  private readonly clientSecret: string
  private tokenCache: TokenCache | null = null

  constructor(opts: DingTalkClientOptions) {
    this.clientId = opts.clientId
    this.clientSecret = opts.clientSecret
  }

  /** Get a cached access token, refreshing one minute before expiry. */
  async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expiresAt > now + TOKEN_REFRESH_LEAD_MS) {
      return this.tokenCache.accessToken
    }
    const res = await net.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: this.clientId, appSecret: this.clientSecret })
    })
    if (!res.ok) {
      throw new DingTalkApiError(`Token request failed (HTTP ${res.status})`, res.status)
    }
    const data = (await res.json()) as { accessToken?: string; expireIn?: number; code?: string; message?: string }
    if (!data.accessToken) {
      throw new DingTalkApiError(`Token response missing accessToken: ${data.message ?? data.code ?? 'unknown'}`)
    }
    this.tokenCache = {
      accessToken: data.accessToken,
      expiresAt: now + (data.expireIn ?? 7200) * 1000
    }
    return data.accessToken
  }

  /**
   * Reply via a `sessionWebhook` URL captured from an inbound message.
   * The webhook is the cheapest and most reliable way to deliver a reply
   * within ~5 minutes of receiving the user message.
   */
  async sendBySessionWebhook(sessionWebhook: string, payload: SessionTextPayload): Promise<void> {
    const res = await net.fetch(sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      throw new DingTalkApiError(`Session webhook send failed (HTTP ${res.status})`, res.status)
    }
    // Some DingTalk endpoints return a JSON body with errcode != 0 even with 200.
    const text = await res.text()
    if (text) {
      try {
        const json = JSON.parse(text) as { errcode?: number; errmsg?: string }
        if (json.errcode !== undefined && json.errcode !== 0) {
          throw new DingTalkApiError(
            `Session webhook send errcode=${json.errcode}: ${json.errmsg ?? ''}`,
            res.status,
            json.errcode
          )
        }
      } catch (err) {
        if (err instanceof DingTalkApiError) throw err
        // Non-JSON body — webhook accepted, ignore.
      }
    }
  }

  /** Proactive send to a group conversation. */
  async sendProactiveGroupText(openConversationId: string, content: string): Promise<void> {
    await this.proactiveSend(GROUP_SEND_URL, {
      robotCode: this.clientId,
      openConversationId,
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content })
    })
  }

  /** Proactive send to one or more user staffIds (DM). */
  async sendProactiveP2PText(userIds: string[], content: string): Promise<void> {
    if (userIds.length === 0) return
    await this.proactiveSend(P2P_SEND_URL, {
      robotCode: this.clientId,
      userIds,
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content })
    })
  }

  private async proactiveSend(url: string, body: Record<string, unknown>): Promise<void> {
    const token = await this.getAccessToken()
    const res = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await safeText(res)
      throw new DingTalkApiError(`Proactive send failed (HTTP ${res.status}): ${text}`, res.status)
    }
  }

  /** Download an inbound media file (image / file / voice / video). */
  async downloadMedia(downloadCode: string): Promise<MediaDownloadResult | null> {
    const token = await this.getAccessToken()
    const res = await net.fetch(MEDIA_DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token
      },
      body: JSON.stringify({ downloadCode, robotCode: this.clientId })
    })
    if (!res.ok) return null
    const data = (await res.json()) as { downloadUrl?: string }
    if (!data.downloadUrl) return null

    const fileRes = await net.fetch(data.downloadUrl, { method: 'GET' })
    if (!fileRes.ok) return null
    const contentType = (fileRes.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
    const buffer = Buffer.from(await fileRes.arrayBuffer())
    return { buffer, contentType }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return '<unreadable>'
  }
}
