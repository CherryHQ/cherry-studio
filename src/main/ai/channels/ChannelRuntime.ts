import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'

import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'
import type { ChannelAdapterLoader } from './channelAdapterLoader'
import type { ChannelLogEntry, ChannelStatusEvent } from './types'

export type ChannelRuntimeDesired =
  | { kind: 'disconnected' }
  | { kind: 'connected'; channel: AgentChannelEntity; agentId: string }

type ChannelRuntimeTarget = ChannelRuntimeDesired & { revision: number }

export interface ChannelRuntimeHooks {
  readDesired: (channelId: string) => ChannelRuntimeDesired
  loadAdapter: ChannelAdapterLoader
  onMessage: (adapter: ChannelAdapter, event: ChannelMessageEvent) => void
  onCommand: (adapter: ChannelAdapter, event: ChannelCommandEvent) => void
  onCredentials: (agentId: string, channelId: string, credentials: { appId: string; appSecret: string }) => void
  onDynamicChatId: (channelId: string, chatId: string) => void
  onLog: (entry: ChannelLogEntry) => void
  onStatus: (status: ChannelStatusEvent) => void
  onError: (channelId: string, error: unknown) => void
}

interface AdapterOwnership {
  adapter: ChannelAdapter
  revision: number
  dynamicChatIds: boolean
  quarantined: boolean
}

interface QrWaiter {
  agentId: string
  resolve: (url: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class ChannelRuntime {
  private readonly reconciler: LatestReconciler
  private requestedRevision = 0
  private appliedRevision = -1
  private ownership?: AdapterOwnership
  private qrWaiter?: QrWaiter
  private lastAgentId?: string

  constructor(
    readonly channelId: string,
    private readonly hooks: ChannelRuntimeHooks
  ) {
    this.reconciler = createLatestReconciler<ChannelRuntimeTarget>({
      name: `channel:${channelId}`,
      getSnapshot: () => {
        const desired = this.hooks.readDesired(channelId)
        if (desired.kind === 'connected') this.lastAgentId = desired.agentId
        return { ...desired, revision: this.requestedRevision }
      },
      isSettled: (target) => this.isSettled(target),
      apply: (target) => this.apply(target),
      onError: (error) => this.hooks.onError(channelId, error)
    })
  }

  get adapter(): ChannelAdapter | undefined {
    return this.ownership && !this.ownership.quarantined ? this.ownership.adapter : undefined
  }

  get ownerAgentId(): string | undefined {
    return this.ownership?.adapter.agentId ?? this.lastAgentId
  }

  requestReconcile(): void {
    this.requestedRevision++
    if (this.ownership && !this.ownership.quarantined) {
      this.ownership.quarantined = true
      this.ownership.adapter.abortConnect()
      this.hooks.onStatus({ channelId: this.channelId, connected: false })
    }
    this.reconciler.request()
  }

  async reconcile(): Promise<void> {
    this.requestReconcile()
    await this.flush()
  }

  async flush(): Promise<void> {
    await this.reconciler.flush()
    const error = this.reconciler.getLastError()
    if (error) throw error
  }

  waitForQrUrl(agentId: string, timeoutMs: number): Promise<string> {
    this.cancelQrWaiter(new Error('QR wait superseded'))
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.qrWaiter?.timer === timer) this.qrWaiter = undefined
        reject(new Error('Timed out waiting for QR code'))
      }, timeoutMs)
      timer.unref?.()
      this.qrWaiter = { agentId, resolve, reject, timer }
    })
  }

  trackDynamicChatId(adapter: ChannelAdapter, chatId: string): void {
    const ownership = this.ownership
    if (!ownership || ownership.adapter !== adapter || !this.isCurrent(ownership)) return
    this.trackChatId(ownership, chatId)
  }

  async dispose(): Promise<void> {
    this.cancelQrWaiter(new Error('Channel runtime disposed'))
    this.reconciler.dispose()
    const ownership = this.ownership
    if (ownership) {
      ownership.quarantined = true
      ownership.adapter.abortConnect()
      await this.disconnectOwnership(ownership, true)
    }
  }

  private isSettled(target: ChannelRuntimeTarget): boolean {
    if (this.appliedRevision !== target.revision) return false
    if (target.kind === 'disconnected') return this.ownership === undefined
    return this.ownership?.revision === target.revision && !this.ownership.quarantined
  }

  private async apply(target: ChannelRuntimeTarget): Promise<void> {
    await this.disconnectCurrent()
    if (target.revision !== this.requestedRevision) return

    if (target.kind === 'disconnected') {
      this.appliedRevision = target.revision
      return
    }

    const adapter = await this.hooks.loadAdapter(target.channel, target.agentId)
    if (target.revision !== this.requestedRevision) {
      adapter.abortConnect()
      await adapter.disconnect().catch(() => undefined)
      return
    }

    const ownership: AdapterOwnership = {
      adapter,
      revision: target.revision,
      dynamicChatIds: adapter.notifyChatIds.length === 0,
      quarantined: false
    }
    if (ownership.dynamicChatIds) adapter.notifyChatIds = [...(target.channel.activeChatIds ?? [])]
    this.bindAdapterEvents(ownership)
    this.ownership = ownership
    this.hooks.onStatus({ channelId: this.channelId, connected: adapter.connected })

    try {
      await adapter.connect()
    } catch (error) {
      if (ownership.quarantined || this.ownership !== ownership) {
        await this.disconnectOwnership(ownership)
        return
      }
      await this.disconnectOwnership(ownership)
      this.hooks.onStatus({
        channelId: this.channelId,
        connected: false,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }

    if (ownership.quarantined || this.ownership !== ownership || target.revision !== this.requestedRevision) {
      await this.disconnectOwnership(ownership)
      return
    }
    this.appliedRevision = target.revision
  }

  private bindAdapterEvents(ownership: AdapterOwnership): void {
    const { adapter } = ownership
    adapter.on('message', (event) => {
      if (!this.isCurrent(ownership)) return
      this.hooks.onMessage(adapter, event)
    })
    adapter.on('command', (event) => {
      if (!this.isCurrent(ownership)) return
      this.hooks.onCommand(adapter, event)
    })
    adapter.on('qr', (url) => {
      if (!this.isCurrent(ownership)) return
      const waiter = this.qrWaiter
      if (!waiter || waiter.agentId !== adapter.agentId) return
      clearTimeout(waiter.timer)
      this.qrWaiter = undefined
      waiter.resolve(url)
    })
    adapter.on('credentials', (credentials) => {
      if (!this.isCurrent(ownership)) return
      this.hooks.onCredentials(adapter.agentId, this.channelId, credentials)
    })
    adapter.on('log', (entry) => {
      if (this.isCurrent(ownership)) this.hooks.onLog(entry)
    })
    adapter.on('statusChange', (status) => {
      if (this.isCurrent(ownership)) this.hooks.onStatus(status)
    })
  }

  private trackChatId(ownership: AdapterOwnership, chatId: string): void {
    if (!ownership.dynamicChatIds || ownership.adapter.notifyChatIds.includes(chatId)) return
    ownership.adapter.notifyChatIds.push(chatId)
    this.hooks.onDynamicChatId(this.channelId, chatId)
  }

  private isCurrent(ownership: AdapterOwnership): boolean {
    return this.ownership === ownership && !ownership.quarantined
  }

  private async disconnectCurrent(): Promise<void> {
    const ownership = this.ownership
    if (!ownership) return
    await this.disconnectOwnership(ownership)
  }

  private async disconnectOwnership(ownership: AdapterOwnership, suppressErrors = false): Promise<void> {
    ownership.quarantined = true
    ownership.adapter.abortConnect()
    let disconnected = false
    try {
      await ownership.adapter.disconnect()
      disconnected = true
    } catch (error) {
      this.hooks.onError(this.channelId, error)
      if (!suppressErrors) throw error
    } finally {
      if (disconnected || suppressErrors) {
        if (this.ownership === ownership) this.ownership = undefined
        ownership.adapter.removeAllListeners()
      }
      this.hooks.onStatus({ channelId: this.channelId, connected: false })
    }
  }

  private cancelQrWaiter(error: Error): void {
    const waiter = this.qrWaiter
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.qrWaiter = undefined
    waiter.reject(error)
  }
}
