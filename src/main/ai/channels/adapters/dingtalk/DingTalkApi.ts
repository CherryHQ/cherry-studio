import { randomUUID } from 'node:crypto'

import { net } from 'electron'
import * as z from 'zod'

import { t } from '@main/i18n'
import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { sanitizeFilename } from '@shared/utils/file'

import type { ChannelConfigForType } from '../../ChannelAdapter'

const API = 'https://api.dingtalk.com'
export const DINGTALK_FILE_BYTES = 20 * 1024 * 1024
export type DingTalkWebhook = { url: string; expiresAt: number }

function failedResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(failedResult)
  const data = value as Record<string, unknown>
  return data.success === false || Object.values(data).some(failedResult)
}

export class DingTalkApi {
  private token?: { value: string; expiresAt: number }
  private tokenRequest?: Promise<string>

  constructor(
    private readonly config: ChannelConfigForType<'dingtalk'>,
    private readonly signal: AbortSignal
  ) {}

  private async request(url: string, body: unknown, token?: string, method = 'POST'): Promise<Record<string, unknown>> {
    this.signal.throwIfAborted()
    try {
      const response = await net.fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]),
        headers: {
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { 'x-acs-dingtalk-access-token': token } : {})
        },
        body: body instanceof FormData ? body : JSON.stringify(body)
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('HTTP failure')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Missing response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > 1024 * 1024) throw new Error('Response too large')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      this.signal.throwIfAborted()
      const data = z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (
        (data.errcode !== undefined && data.errcode !== 0) ||
        (data.code !== undefined && data.code !== 'OK' && data.code !== 0) ||
        failedResult(data) ||
        [data.invalidStaffIdList, data.flowControlledStaffIdList, data.invalidUserIdList].some(
          (ids) => Array.isArray(ids) && ids.length
        )
      ) {
        throw new Error('API failure')
      }
      return data
    } catch {
      // Transport errors may contain signed URLs, access tokens or request bodies.
      throw new Error(t('common.dingtalk_delivery_failed'))
    }
  }

  private async accessToken(): Promise<string> {
    this.signal.throwIfAborted()
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value
    if (!this.tokenRequest) {
      this.tokenRequest = this.request(`${API}/v1.0/oauth2/accessToken`, {
        appKey: this.config.client_id,
        appSecret: this.config.client_secret
      })
        .then((data) => {
          const parsed = z.object({ accessToken: z.string().min(1), expireIn: z.number().positive() }).safeParse(data)
          if (!parsed.success) throw new Error(t('common.dingtalk_delivery_failed'))
          this.token = {
            value: parsed.data.accessToken,
            expiresAt: Date.now() + Math.max(0, parsed.data.expireIn - 60) * 1000
          }
          return this.token.value
        })
        .finally(() => {
          this.tokenRequest = undefined
        })
    }
    return this.tokenRequest
  }

  private async call(path: string, body: unknown, method = 'POST') {
    return this.request(`${API}${path}`, body, await this.accessToken(), method)
  }

  private async send(chatId: string, msgKey: string, msgParam: Record<string, string>): Promise<void> {
    const group = chatId.startsWith('group:')
    const result = await this.call(group ? '/v1.0/robot/groupMessages/send' : '/v1.0/robot/oToMessages/batchSend', {
      robotCode: this.config.robot_code,
      ...(group ? { openConversationId: chatId.slice(6) } : { userIds: [chatId.slice(3)] }),
      msgKey,
      msgParam: JSON.stringify(msgParam)
    })
    if (typeof result.processQueryKey !== 'string' || !result.processQueryKey)
      throw new Error(t('common.dingtalk_delivery_failed'))
  }

  async sendText(chatId: string, text: string, webhook?: DingTalkWebhook): Promise<void> {
    if (webhook && webhook.expiresAt > Date.now()) {
      const url = URL.parse(webhook.url)
      if (
        !url ||
        url.origin !== 'https://oapi.dingtalk.com' ||
        url.pathname !== '/robot/sendBySession' ||
        url.username ||
        url.password ||
        url.hash ||
        !url.searchParams.get('session')
      ) {
        throw new Error(t('common.dingtalk_delivery_failed'))
      }
      const result = await this.request(url.href, { msgtype: 'text', text: { content: text } })
      if (result.errcode !== 0) throw new Error(t('common.dingtalk_delivery_failed'))
      return
    }
    await this.send(chatId, 'sampleText', { content: text })
  }

  async downloadUrl(downloadCode: string): Promise<string> {
    const result = await this.call('/v1.0/robot/messageFiles/download', {
      downloadCode,
      robotCode: this.config.robot_code
    })
    if (typeof result.downloadUrl !== 'string') throw new Error(t('common.dingtalk_attachment_failed'))
    return result.downloadUrl
  }

  async sendFile(chatId: string, file: FileAttachment): Promise<void> {
    if (file.size > DINGTALK_FILE_BYTES || file.data.length > Math.ceil(DINGTALK_FILE_BYTES / 3) * 4)
      throw new Error(t('common.dingtalk_file_size'))
    const bytes = Buffer.from(file.data, 'base64')
    if (!bytes.length || bytes.length > DINGTALK_FILE_BYTES) throw new Error(t('common.dingtalk_file_size'))
    const filename = sanitizeFilename(file.filename)
    const fileType = filename.includes('.') ? filename.split('.').at(-1)?.toLowerCase() : undefined
    if (!fileType) throw new Error(t('common.dingtalk_file_type'))
    const form = new FormData()
    form.append('media', new Blob([bytes], { type: 'application/octet-stream' }), filename)
    const token = await this.accessToken()
    const result = await this.request(
      `https://oapi.dingtalk.com/media/upload?type=file&access_token=${encodeURIComponent(token)}`,
      form
    )
    if (result.errcode !== 0 || typeof result.media_id !== 'string' || !result.media_id)
      throw new Error(t('common.dingtalk_delivery_failed'))
    await this.send(chatId, 'sampleFile', { mediaId: result.media_id, fileName: filename, fileType })
  }

  async createCard(outTrackId: string): Promise<void> {
    await this.call('/v1.0/card/instances', {
      cardTemplateId: this.config.card_template_id,
      outTrackId,
      callbackType: 'STREAM',
      cardData: { cardParamMap: { msgContent: t('common.dingtalk_processing'), flowStatus: '2' } },
      imGroupOpenSpaceModel: { supportForward: false },
      imRobotOpenSpaceModel: { supportForward: false }
    })
  }

  async deliverCard(chatId: string, outTrackId: string): Promise<void> {
    const group = chatId.startsWith('group:')
    const result = await this.call('/v1.0/card/instances/deliver', {
      outTrackId,
      userIdType: 1,
      openSpaceId: `dtv1.card//${group ? 'IM_GROUP' : 'IM_ROBOT'}.${chatId.slice(group ? 6 : 3)}`,
      ...(group
        ? { imGroupOpenDeliverModel: { robotCode: this.config.robot_code } }
        : {
            imRobotOpenDeliverModel: { robotCode: this.config.robot_code, spaceType: 'IM_ROBOT' }
          })
    })
    if (
      !Array.isArray(result.result) ||
      result.result.length === 0 ||
      result.result.some((item) => !item || item.success !== true)
    ) {
      throw new Error(t('common.dingtalk_delivery_failed'))
    }
  }

  async updateCard(outTrackId: string, content: string, finished: boolean, error = false): Promise<void> {
    await this.call(
      '/v1.0/card/streaming',
      {
        outTrackId,
        guid: randomUUID(),
        key: 'msgContent',
        content,
        isFull: true,
        isFinalize: finished,
        isError: error
      },
      'PUT'
    )
    if (finished) {
      await this.call(
        '/v1.0/card/instances',
        {
          outTrackId,
          cardData: { cardParamMap: { msgContent: content, flowStatus: error ? '5' : '3' } },
          cardUpdateOptions: { updateCardDataByKey: true }
        },
        'PUT'
      )
    }
  }
}
