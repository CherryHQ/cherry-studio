import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { CredentialStoreError } from '@main/services/credential'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'

import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'
import { loadChannelAdapter } from './channelAdapterLoader'
import { ChannelLogBuffer } from './ChannelLogBuffer'
import { channelMessageHandler } from './ChannelMessageHandler'
import { ChannelRegistration } from './ChannelRegistration'
import { ChannelRuntime, type ChannelRuntimeDesired } from './ChannelRuntime'
import type { ChannelLogEntry, ChannelStatusEvent } from './types'

const logger = loggerService.withContext('ChannelManager')

@Injectable('ChannelManager')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'WindowManager',
  'FileManager',
  'PowerService',
  'FeishuCredentialMigrationService',
  'FeishuRegistrationService'
])
export class ChannelManager extends BaseService {
  readonly registration = new ChannelRegistration()
  private readonly runtimes = new Map<string, ChannelRuntime>()
  private readonly channelLogs = new ChannelLogBuffer()
  private acceptingConnections = false
  private readonly feishuRegistrations = new Map<string, { id: string; owner: string }>()
  private readonly registrationFlights = new Set<Promise<void>>()

  protected async onReady(): Promise<void> {
    this.registerDisposable(application.get('PowerService').onResume(() => this.handleSystemResume()))
    this.registerDisposable(
      application.get('CredentialStoreService').onDidChange((event) => {
        if (event.kind !== 'application' || event.operation === 'created') return
        for (const channel of channelService.listChannels({ type: 'feishu' })) {
          if (channel.type === 'feishu' && channel.config.applicationCredentialId === event.id)
            this.requestReconcile(channel.id)
        }
      })
    )
    await this.start()
  }

  protected async onStop(): Promise<void> {
    await this.stop()
  }

  pause(reason?: string): Disposable {
    return channelMessageHandler.pause(reason)
  }

  drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    return channelMessageHandler.drainInFlight(opts)
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return channelMessageHandler.listActiveWork()
  }

  async start(): Promise<void> {
    this.acceptingConnections = true
    let channels: ReturnType<typeof channelService.listChannels>
    try {
      channels = channelService.listChannels()
    } catch (error) {
      logger.error('Failed to list channels during startup', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    for (const channel of channels) this.requestReconcile(channel.id)
    logger.info('Channel manager started', { channelCount: channels.length })
  }

  async stop(): Promise<void> {
    this.acceptingConnections = false
    this.registration.dispose()
    for (const id of this.feishuRegistrations.keys()) this.cancelFeishuRegistration(id)
    await Promise.allSettled([...this.registrationFlights])
    logger.info('Stopping channel manager')
    const runtimes = [...this.runtimes.values()]
    for (const runtime of runtimes) runtime.requestReconcile()
    await Promise.allSettled(runtimes.map((runtime) => runtime.flush()))
    await Promise.allSettled(runtimes.map((runtime) => runtime.dispose()))
    this.runtimes.clear()
    logger.info('Channel manager stopped')
  }

  requestReconcile(channelId: string): void {
    this.cancelFeishuRegistration(channelId)
    this.getOrCreateRuntime(channelId).requestReconcile()
  }

  async reconcileChannel(channelId: string): Promise<void> {
    this.cancelFeishuRegistration(channelId)
    await this.getOrCreateRuntime(channelId).reconcile()
  }

  waitForQrAndReconcile(agentId: string, channelId: string, timeoutMs = 30_000): Promise<string> {
    const channel = channelService.getChannel(channelId)
    if (channel?.type === 'feishu') return this.beginFeishuRegistration(agentId, channelId)
    const runtime = this.getOrCreateRuntime(channelId)
    const qrUrl = runtime.waitForQrUrl(agentId, timeoutMs)
    runtime.requestReconcile()
    return qrUrl
  }

  async removeChannel(channelId: string): Promise<void> {
    this.cancelFeishuRegistration(channelId)
    const runtime = this.runtimes.get(channelId)
    this.runtimes.delete(channelId)
    this.channelLogs.remove(channelId)
    if (runtime) {
      runtime.requestReconcile()
      await runtime.flush().catch((error) => this.logRuntimeError(channelId, error))
      await runtime.dispose()
    }
    application.get('CacheService').deleteShared(`channel.status.${channelId}`)
  }

  getAdapterStatuses(agentId: string): Array<{ channelId: string; connected: boolean }> {
    const result: Array<{ channelId: string; connected: boolean }> = []
    for (const [channelId, runtime] of this.runtimes) {
      const adapter = runtime.adapter
      if (adapter?.agentId === agentId) result.push({ channelId, connected: adapter.connected })
    }
    return result
  }

  getAgentAdapters(agentId: string): ChannelAdapter[] {
    return [...this.runtimes.values()]
      .map((runtime) => runtime.adapter)
      .filter((adapter): adapter is ChannelAdapter => adapter?.agentId === agentId)
  }

  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.runtimes.get(channelId)?.adapter
  }

  getChannelLogs(channelId: string): ChannelLogEntry[] {
    return this.channelLogs.get(channelId)
  }

  private handleSystemResume(): void {
    for (const runtime of this.runtimes.values()) runtime.adapter?.handleSystemResume()
  }

  private getOrCreateRuntime(channelId: string): ChannelRuntime {
    const existing = this.runtimes.get(channelId)
    if (existing) return existing

    const runtime = new ChannelRuntime(channelId, {
      readDesired: (id) => this.readDesired(id),
      loadAdapter: loadChannelAdapter,
      onMessage: (adapter, event) => this.handleMessage(adapter, event),
      onCommand: (adapter, event) => this.handleCommand(adapter, event),
      onDynamicChatId: (id, chatId) => this.persistDynamicChatId(id, chatId),
      onLog: (entry) => this.publishLog(entry),
      onStatus: (status) => this.publishStatus(status),
      onError: (id, error) => this.logRuntimeError(id, error)
    })
    this.runtimes.set(channelId, runtime)
    return runtime
  }

  private readDesired(channelId: string): ChannelRuntimeDesired {
    if (!this.acceptingConnections) return { kind: 'disconnected' }
    const channel = channelService.getChannel(channelId)
    if (!channel?.isActive || !channel.agentId) return { kind: 'disconnected' }
    if (
      channel.type === 'feishu' &&
      (!channel.config.applicationCredentialId ||
        application.get('FeishuCredentialMigrationService').isChannelBlocked(channelId))
    )
      return { kind: 'disconnected' }
    if (agentService.getLifecycleState(channel.agentId) !== 'active') return { kind: 'disconnected' }
    return { kind: 'connected', channel, agentId: channel.agentId }
  }

  reconcileAgent(agentId: string, clearSessionTracker = false): void {
    if (clearSessionTracker) channelMessageHandler.clearSessionTracker(agentId)
    const channelIds = new Set<string>()
    for (const [channelId, runtime] of this.runtimes) {
      if (runtime.ownerAgentId === agentId) channelIds.add(channelId)
    }
    try {
      for (const channel of channelService.listChannels({ agentId })) channelIds.add(channel.id)
    } catch (error) {
      logger.warn('Failed to list Agent channels during lifecycle reconciliation', {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    for (const channelId of channelIds) this.requestReconcile(channelId)
  }

  private handleMessage(adapter: ChannelAdapter, event: ChannelMessageEvent): void {
    if (channelMessageHandler.isWriteQuiesced) {
      logger.warn('Channel message dropped: intake is write-quiesced', {
        agentId: adapter.agentId,
        channelId: adapter.channelId
      })
      return
    }
    this.runtimes.get(adapter.channelId)?.trackDynamicChatId(adapter, event.chatId)
    channelMessageHandler.handleIncoming(adapter, event).catch((error) => {
      logger.error('Unhandled error in message handler', {
        agentId: adapter.agentId,
        channelId: adapter.channelId,
        error: error instanceof Error ? error.message : String(error)
      })
      adapter
        .sendMessage(event.chatId, t('common.channel_message_processing_error'), {
          replyToMessageId: event.messageId,
          ...(event.replyInThread && { replyInThread: true })
        })
        .catch(() => undefined)
    })
  }

  private handleCommand(adapter: ChannelAdapter, event: ChannelCommandEvent): void {
    if (channelMessageHandler.isWriteQuiesced) {
      logger.warn('Channel command dropped: intake is write-quiesced', {
        agentId: adapter.agentId,
        channelId: adapter.channelId
      })
      return
    }
    this.runtimes.get(adapter.channelId)?.trackDynamicChatId(adapter, event.chatId)
    channelMessageHandler.handleCommand(adapter, event).catch((error) => {
      logger.error('Unhandled error in command handler', {
        agentId: adapter.agentId,
        channelId: adapter.channelId,
        error: error instanceof Error ? error.message : String(error)
      })
      adapter
        .sendMessage(event.chatId, t('common.channel_command_processing_error'), {
          replyToMessageId: event.messageId,
          ...(event.replyInThread && { replyInThread: true })
        })
        .catch(() => undefined)
    })
  }

  private persistDynamicChatId(channelId: string, chatId: string): void {
    try {
      channelService.addActiveChatId(channelId, chatId)
    } catch (error) {
      logger.warn('Failed to persist activeChatId', {
        channelId,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private cancelFeishuRegistration(channelId: string): void {
    const pending = this.feishuRegistrations.get(channelId)
    if (!pending) return
    this.feishuRegistrations.delete(channelId)
    application.get('FeishuRegistrationService').cancel(pending.owner, pending.id)
  }

  private async beginFeishuRegistration(agentId: string, channelId: string): Promise<string> {
    const channel = channelService.getChannel(channelId)
    if (
      !this.acceptingConnections ||
      channel?.type !== 'feishu' ||
      channel.agentId !== agentId ||
      !channel.isActive ||
      channel.config.applicationCredentialId ||
      application.get('FeishuCredentialMigrationService').isChannelBlocked(channelId)
    )
      throw new CredentialStoreError('invalid')
    this.cancelFeishuRegistration(channelId)
    const pending = { id: randomUUID(), owner: `agent:${agentId}` }
    this.feishuRegistrations.set(channelId, pending)
    const registration = application.get('FeishuRegistrationService')
    try {
      const begun = await registration.beginAgent(agentId, {
        requestId: pending.id,
        purpose: 'channel',
        domain: channel.config.registrationDomain ?? 'feishu'
      })
      if (this.feishuRegistrations.get(channelId) !== pending) throw new CredentialStoreError('conflict')
      const flight = (async () => {
        try {
          const app = await registration.complete(pending.owner, pending.id)
          await application.get('CredentialStoreService').withReferences([app.id], () => {
            const latest = channelService.getChannel(channelId)
            if (
              this.feishuRegistrations.get(channelId) !== pending ||
              latest?.type !== 'feishu' ||
              latest.agentId !== agentId ||
              !latest.isActive ||
              latest.config.applicationCredentialId
            )
              throw new CredentialStoreError('conflict')
            channelService.updateChannel(channelId, {
              config: { applicationCredentialId: app.id, allowed_chat_ids: latest.config.allowed_chat_ids }
            })
          })
          if (this.feishuRegistrations.get(channelId) === pending) {
            this.sendToRenderer('channel.feishu.qr_login', { channelId, url: '', status: 'confirmed' })
            this.cancelFeishuRegistration(channelId)
            this.requestReconcile(channelId)
          }
        } catch {
          if (this.feishuRegistrations.get(channelId) === pending) {
            this.sendToRenderer('channel.feishu.qr_login', { channelId, url: '', status: 'error' })
            this.cancelFeishuRegistration(channelId)
          }
        }
      })()
      this.registrationFlights.add(flight)
      void flight.finally(() => this.registrationFlights.delete(flight))
      return begun.verificationUri
    } catch (error) {
      if (this.feishuRegistrations.get(channelId) === pending) this.cancelFeishuRegistration(channelId)
      throw error
    }
  }

  private publishLog(entry: ChannelLogEntry): void {
    this.channelLogs.append(entry.channelId, entry)
    this.sendToRenderer('channel.log', entry)
  }

  private publishStatus(status: ChannelStatusEvent): void {
    application.get('CacheService').setShared(`channel.status.${status.channelId}`, status)
  }

  private sendToRenderer<E extends IpcEventName>(event: E, data: EventPayload<E>): void {
    application.get('IpcApiService').broadcastToType(WindowType.Main, event, data)
  }

  private logRuntimeError(channelId: string, error: unknown): void {
    logger.error('Channel runtime reconciliation failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
