import { net } from 'electron'
import { delay } from 'es-toolkit'
import * as z from 'zod'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import type { OutputFor } from '@shared/ipc/types'

const text = z.string().min(1).max(4096)
const wecomBegin = z.object({ data: z.object({ scode: text, auth_url: text }) })
const wecomPoll = z.object({
  data: z.object({ status: text, bot_info: z.object({ botid: text, secret: text }).optional() })
})

const dingtalkInit = z.object({ errcode: z.literal(0), nonce: text })
const dingtalkBegin = z.object({
  errcode: z.literal(0),
  device_code: text,
  verification_uri_complete: text,
  interval: z.number().positive().max(60).default(3),
  expires_in: z.number().positive().default(300)
})
const dingtalkPoll = z.object({
  errcode: z.literal(0),
  status: z.enum(['WAITING', 'CREATING', 'SUCCESS', 'FAIL', 'EXPIRED']),
  client_id: text.optional(),
  client_secret: text.optional()
})

type Session = {
  type: 'wecom' | 'dingtalk'
  interval: number
  id: string
  owner: string
  channelId: string
  originalConfig: string
  controller: AbortController
  dispose: () => void
  code?: string
  expiresAt: number
  pending?: Promise<OutputFor<'channel.registration.poll'>>
}

/** Owned and disposed by ChannelManager; credentials never leave the main process. */
export class ChannelRegistration {
  private readonly sessions = new Map<string, Session>()

  async begin(
    owner: string | null,
    channelId: string,
    requestId: string
  ): Promise<OutputFor<'channel.registration.begin'>> {
    const window = owner ? application.get('WindowManager').getWindow(owner) : undefined
    const channel = agentChannelService.getChannel(channelId)
    if (
      !owner ||
      !window ||
      window.isDestroyed() ||
      !channel ||
      channel.isActive ||
      (channel.type !== 'wecom' && channel.type !== 'dingtalk')
    ) {
      throw new Error('Channel registration is unavailable')
    }
    if (this.sessions.has(requestId)) throw new Error('Registration request already exists')
    for (const session of this.sessions.values()) {
      if (session.owner === owner || session.channelId === channelId) this.cancel(session.owner, session.id)
    }
    if (this.sessions.size >= 20) throw new Error('Too many channel registrations')
    const controller = new AbortController()
    const close = () => this.cancel(owner, requestId)
    const timer = setTimeout(close, 300_000)
    timer.unref()
    window.once('closed', close)
    const session: Session = {
      type: channel.type,
      interval: 3000,
      id: requestId,
      owner,
      channelId,
      originalConfig: JSON.stringify(channel.config),
      controller,
      expiresAt: Date.now() + 300_000,
      dispose: () => {
        clearTimeout(timer)
        window.removeListener('closed', close)
        controller.abort()
      }
    }
    this.sessions.set(requestId, session)
    try {
      let verificationUrl: string
      if (session.type === 'dingtalk') {
        const base = 'https://oapi.dingtalk.com/app/registration'
        const init = dingtalkInit.parse(
          await this.request(`${base}/init`, controller.signal, { source: 'DING_DWS_CLAW' })
        )
        const result = dingtalkBegin.parse(
          await this.request(`${base}/begin`, controller.signal, { nonce: init.nonce })
        )
        session.code = result.device_code
        session.interval = Math.max(1000, result.interval * 1000)
        session.expiresAt = Math.min(session.expiresAt, Date.now() + result.expires_in * 1000)
        verificationUrl = result.verification_uri_complete
      } else {
        const plat = process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3
        const result = wecomBegin.parse(
          await this.request(
            `https://work.weixin.qq.com/ai/qc/generate?source=cherry-studio&plat=${plat}`,
            controller.signal
          )
        ).data
        session.code = result.scode
        verificationUrl = result.auth_url
      }
      const url = URL.parse(verificationUrl)
      const expected =
        session.type === 'wecom'
          ? 'https://work.weixin.qq.com/ai/qc/c'
          : 'https://open-dev.dingtalk.com/openapp/registration/openClaw'
      if (!url || `${url.origin}${url.pathname}` !== expected || url.username || url.password) {
        throw new Error('Invalid authorization URL')
      }
      controller.signal.throwIfAborted()
      return { requestId, url: url.href, expiresAt: session.expiresAt }
    } catch {
      this.cancel(owner, requestId)
      throw new Error('Channel registration failed')
    }
  }

  async poll(owner: string | null, requestId: string): Promise<OutputFor<'channel.registration.poll'>> {
    const session = this.sessions.get(requestId)
    if (!session || session.owner !== owner || !session.code) return { status: 'cancelled' }
    session.pending ??= this.pollSession(session).finally(() => {
      session.pending = undefined
    })
    return session.pending
  }

  cancel(owner: string | null, requestId: string): void {
    const session = this.sessions.get(requestId)
    if (!session || session.owner !== owner) return
    this.sessions.delete(requestId)
    session.dispose()
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.cancel(session.owner, session.id)
  }

  private async pollSession(session: Session): Promise<OutputFor<'channel.registration.poll'>> {
    const { signal } = session.controller
    try {
      await delay(session.interval, { signal })
      if (Date.now() >= session.expiresAt) throw new Error('Registration expired')
      let status: 'pending' | 'success' | 'expired'
      let credentials: Record<string, string> | undefined
      if (session.type === 'dingtalk') {
        const data = dingtalkPoll.parse(
          await this.request('https://oapi.dingtalk.com/app/registration/poll', signal, { device_code: session.code! })
        )
        if (data.status === 'FAIL') throw new Error('Registration denied')
        status =
          data.status === 'WAITING' || data.status === 'CREATING'
            ? 'pending'
            : data.status === 'EXPIRED'
              ? 'expired'
              : 'success'
        if (data.client_id && data.client_secret) {
          credentials = {
            client_id: data.client_id.trim(),
            client_secret: data.client_secret,
            // DING_DWS_CLAW creates app bots; the official connector uses clientId as robotCode.
            // https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/5fef12d37377e299e26d18b0145baf646cd17a8b/src/services/media.ts#L779
            robot_code: data.client_id.trim()
          }
        }
      } else {
        const data = wecomPoll.parse(
          await this.request(
            `https://work.weixin.qq.com/ai/qc/query_result?scode=${encodeURIComponent(session.code!)}`,
            signal
          )
        ).data
        if (['init', 'pending', 'scanned'].includes(data.status)) status = 'pending'
        else if (data.status === 'expired') status = 'expired'
        else if (data.status === 'success') status = 'success'
        else throw new Error('Registration unsuccessful')
        if (data.bot_info) credentials = { bot_id: data.bot_info.botid.trim(), secret: data.bot_info.secret }
      }
      signal.throwIfAborted()
      if (status === 'pending') return { status }
      if (status === 'expired') {
        this.cancel(session.owner, session.id)
        return { status }
      }
      if (!credentials) throw new Error('Registration credentials missing')
      const channel = agentChannelService.getChannel(session.channelId)
      if (
        !channel ||
        channel.isActive ||
        channel.type !== session.type ||
        JSON.stringify(channel.config) !== session.originalConfig
      ) {
        this.cancel(session.owner, session.id)
        return { status: 'cancelled' }
      }
      agentChannelService.updateChannel(channel.id, {
        config: { ...channel.config, ...credentials }
      })
      this.cancel(session.owner, session.id)
      return { status: 'confirmed' }
    } catch {
      const status = Date.now() >= session.expiresAt ? 'expired' : signal.aborted ? 'cancelled' : 'error'
      this.cancel(session.owner, session.id)
      return { status }
    }
  }

  private async request(url: string, signal: AbortSignal, body?: Record<string, string>): Promise<unknown> {
    signal.throwIfAborted()
    const response = await net.fetch(url, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
      credentials: 'omit'
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Registration HTTP failure')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing registration response')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 65536) throw new Error('Registration response too large')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    signal.throwIfAborted()
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
}
