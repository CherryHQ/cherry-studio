import { shell } from 'electron'

import { application } from '@application'
import type { RuntimeLoginRequest, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { agentService } from '@data/services/AgentService'
import { resolveLocalRuntimeAccount } from '@main/ai/runtime/LocalRuntimeDriver'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { StoredLocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { WindowId } from '@shared/ipc/types'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

const AUTH_TIMEOUT_MS = 300_000

function redactAuthMessage(message: string, config: LocalAgentConfiguration, secret?: string): string {
  let sanitized = message
  if (secret) sanitized = redactLiteral(sanitized, secret)
  for (const [key, value] of Object.entries(config.env)) {
    if (isSensitiveKey(key)) sanitized = redactLiteral(sanitized, value)
  }
  return sanitized
}

@Injectable('LocalAgentAuthService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentAuthService extends BaseService {
  private readonly shutdown = new AbortController()
  private readonly usageRequests = new Map<string, Promise<SubscriptionUsageResult>>()
  private accountGeneration = 0
  private readonly pending = new Map<string, () => Promise<void>>()

  async authenticate(
    requestId: string,
    config: LocalAgentConfiguration,
    methodId: string,
    options?: Omit<RuntimeLoginRequest, 'methodId'>,
    senderId: WindowId | null = null
  ): Promise<void> {
    this.shutdown.signal.throwIfAborted()
    const key = JSON.stringify([senderId, requestId])
    if (this.pending.has(key)) throw new Error('Authentication is already in progress')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Authentication timed out')), AUTH_TIMEOUT_MS)
    this.accountGeneration++
    const work = this.run(senderId, requestId, config, { methodId, ...options }, controller.signal)
    this.pending.set(key, async () => {
      controller.abort(new Error('Authentication cancelled'))
      await work.catch(() => {})
    })
    try {
      await work
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error
      throw new Error(
        redactAuthMessage(cause instanceof Error ? cause.message : String(cause), config, options?.secret)
      )
    } finally {
      this.accountGeneration++
      clearTimeout(timer)
      this.pending.delete(key)
    }
  }

  private async run(
    senderId: WindowId | null,
    requestId: string,
    config: LocalAgentConfiguration,
    request: RuntimeLoginRequest,
    signal: AbortSignal
  ) {
    const account = await resolveLocalRuntimeAccount(config)
    signal.throwIfAborted()
    if (!account.authenticate) throw new Error('Authentication is unavailable')
    await account.authenticate(
      request,
      {
        showPrompt: ({ url, code }) => {
          if (!senderId || signal.aborted) return
          const payload = {
            requestId,
            ...(url && { url: redactAuthMessage(url, config, request.secret) }),
            ...(code && { code: redactAuthMessage(code, config, request.secret) })
          }
          application.get('IpcApiService').send(senderId, 'ai.local_agents.auth_prompt', payload)
        },
        async openBrowser(url) {
          signal.throwIfAborted()
          const protocol = new URL(url).protocol
          if (protocol !== 'https:' && protocol !== 'http:') throw new Error('Invalid login URL')
          if (redactAuthMessage(url, config, request.secret) !== url) throw new Error('Invalid login URL')
          await shell.openExternal(url)
        }
      },
      signal
    )
    signal.throwIfAborted()
  }

  async cancel(requestId: string, senderId: WindowId | null = null): Promise<void> {
    await this.pending.get(JSON.stringify([senderId, requestId]))?.()
  }

  async readSubscriptionUsage(agentId: string): Promise<SubscriptionUsageResult> {
    const agent = agentService.getAgent(agentId)
    const config = StoredLocalAgentConfigurationSchema.safeParse(agent?.configuration?.localRuntime)
    if (!agent || agent.deletedAt || !config.success) return { status: 'unsupported' }
    if (this.pending.size || this.shutdown.signal.aborted) return { status: 'unavailable' }
    const generation = this.accountGeneration
    const key = JSON.stringify([agentId, agent.updatedAt, generation])
    const existing = this.usageRequests.get(key)
    if (existing) return existing

    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(30_000)])
    const read = async (): Promise<SubscriptionUsageResult> => {
      try {
        const account = await resolveLocalRuntimeAccount(config.data)
        if (!account.readSubscriptionUsage) return { status: 'unsupported' }
        const result = await account.readSubscriptionUsage(signal)
        if (
          signal.aborted ||
          generation !== this.accountGeneration ||
          agent.updatedAt !== agentService.getAgent(agentId)?.updatedAt
        )
          return { status: 'unavailable' }
        return result
      } catch {
        return { status: 'unavailable' }
      }
    }

    const work = read().finally(() => this.usageRequests.delete(key))
    this.usageRequests.set(key, work)
    return work
  }

  protected async onStop() {
    this.shutdown.abort()
    try {
      await Promise.all([...this.pending.values()].map((stop) => stop()))
      await Promise.all(this.usageRequests.values())
    } finally {
      this.pending.clear()
    }
  }
}
