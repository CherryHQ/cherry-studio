import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import type { ChannelConfig } from '@shared/data/types/channel'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'

import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'
import { loadChannelAdapter } from './channelAdapterLoader'
import { ChannelLogBuffer } from './ChannelLogBuffer'
import { channelMessageHandler } from './ChannelMessageHandler'
import { ChannelRuntime, type ChannelRuntimeDesired } from './ChannelRuntime'
import type { ChannelLogEntry, ChannelStatusEvent } from './types'

const logger = loggerService.withContext('ChannelManager')

@Injectable('ChannelManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class ChannelManager extends BaseService {
  private readonly runtimes = new Map<string, ChannelRuntime>()
  private readonly channelLogs = new ChannelLogBuffer()
  private acceptingConnections = false

  protected async onReady(): Promise<void> {
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
    logger.info('Stopping channel manager')
    const runtimes = [...this.runtimes.values()]
    for (const runtime of runtimes) runtime.requestReconcile()
    await Promise.allSettled(runtimes.map((runtime) => runtime.flush()))
    await Promise.allSettled(runtimes.map((runtime) => runtime.dispose()))
    this.runtimes.clear()
    logger.info('Channel manager stopped')
  }

  requestReconcile(channelId: string): void {
    this.getOrCreateRuntime(channelId).requestReconcile()
  }

  async reconcileChannel(channelId: string): Promise<void> {
    await this.getOrCreateRuntime(channelId).reconcile()
  }

  waitForQrAndReconcile(agentId: string, channelId: string, timeoutMs = 30_000): Promise<string> {
    const runtime = this.getOrCreateRuntime(channelId)
    const qrUrl = runtime.waitForQrUrl(agentId, timeoutMs)
    runtime.requestReconcile()
    return qrUrl
  }

  async removeChannel(channelId: string): Promise<void> {
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

  private getOrCreateRuntime(channelId: string): ChannelRuntime {
    const existing = this.runtimes.get(channelId)
    if (existing) return existing

    const runtime = new ChannelRuntime(channelId, {
      readDesired: (id) => this.readDesired(id),
      loadAdapter: loadChannelAdapter,
      onMessage: (adapter, event) => this.handleMessage(adapter, event),
      onCommand: (adapter, event) => this.handleCommand(adapter, event),
      onCredentials: (agentId, id, credentials) => this.saveCredentials(agentId, id, credentials),
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

  private saveCredentials(agentId: string, channelId: string, credentials: { appId: string; appSecret: string }): void {
    try {
      const channel = channelService.getChannel(channelId)
      if (!channel || channel.agentId !== agentId) return
      const config = channel.config as ChannelConfig & Record<string, unknown>
      channelService.updateChannel(channelId, {
        config: { ...config, app_id: credentials.appId, app_secret: credentials.appSecret }
      })
      this.requestReconcile(channelId)
    } catch (error) {
      logger.error('Failed to save channel credentials', {
        agentId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      })
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
