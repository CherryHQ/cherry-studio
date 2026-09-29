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

type Session = {
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
    if (!owner || !window || window.isDestroyed() || !channel || channel.isActive || channel.type !== 'wecom') {
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
      const plat = process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3
      const result = wecomBegin.parse(
        await this.request(
          `https://work.weixin.qq.com/ai/qc/generate?source=cherry-studio&plat=${plat}`,
          controller.signal
        )
      ).data
      const url = URL.parse(result.auth_url)
      if (
        !url ||
        url.origin !== 'https://work.weixin.qq.com' ||
        url.pathname !== '/ai/qc/c' ||
        url.username ||
        url.password
      ) {
        throw new Error('Invalid authorization URL')
      }
      controller.signal.throwIfAborted()
      session.code = result.scode
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
      await delay(3000, { signal })
      const data = wecomPoll.parse(
        await this.request(
          `https://work.weixin.qq.com/ai/qc/query_result?scode=${encodeURIComponent(session.code!)}`,
          signal
        )
      ).data
      signal.throwIfAborted()
      if (data.status === 'init' || data.status === 'pending' || data.status === 'scanned') return { status: 'pending' }
      if (data.status === 'expired') {
        this.cancel(session.owner, session.id)
        return { status: 'expired' }
      }
      if (data.status !== 'success' || !data.bot_info) throw new Error('Registration unsuccessful')
      const channel = agentChannelService.getChannel(session.channelId)
      if (
        !channel ||
        channel.isActive ||
        channel.type !== 'wecom' ||
        JSON.stringify(channel.config) !== session.originalConfig
      ) {
        this.cancel(session.owner, session.id)
        return { status: 'cancelled' }
      }
      agentChannelService.updateChannel(channel.id, {
        config: { ...channel.config, bot_id: data.bot_info.botid.trim(), secret: data.bot_info.secret }
      })
      this.cancel(session.owner, session.id)
      return { status: 'confirmed' }
    } catch {
      const status = Date.now() >= session.expiresAt ? 'expired' : signal.aborted ? 'cancelled' : 'error'
      this.cancel(session.owner, session.id)
      return { status }
    }
  }

  private async request(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await net.fetch(url, {
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
