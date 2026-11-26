import { randomUUID } from 'node:crypto'

import { shell } from 'electron'

import { application } from '@application'
import type { RuntimeLoginHost, RuntimeLoginRequest, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { agentService } from '@data/services/AgentService'
import { resolveLocalRuntimeAccount } from '@main/ai/runtime/LocalRuntimeDriver'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { StoredLocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { WindowId } from '@shared/ipc/types'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

const AUTH_TIMEOUT_MS = 300_000
type BrowserDecision = Awaited<ReturnType<NonNullable<RuntimeLoginHost['confirmBrowser']>>>
type AuthAttempt = {
  cancel(): Promise<void>
  consent?: { id: string; resolve(decision: BrowserDecision): void }
}

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
  private readonly pending = new Map<string, AuthAttempt>()

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
    const attempt: AuthAttempt = {
      async cancel() {
        controller.abort(new Error('Authentication cancelled'))
        await work.catch(() => {})
      }
    }
    this.pending.set(key, attempt)
    const work = this.run(senderId, requestId, config, { methodId, ...options }, attempt, controller.signal)
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
    attempt: AuthAttempt,
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
        },
        confirmBrowser: senderId
          ? async ({ url, message }, requestSignal) => {
              const consentSignal = AbortSignal.any([signal, requestSignal])
              if (consentSignal.aborted || attempt.consent) return 'cancel'
              const target = URL.parse(url)
              if (
                !target ||
                (target.protocol !== 'https:' && target.protocol !== 'http:') ||
                target.username ||
                target.password
              )
                throw new Error('Invalid login URL')
              const destination = target.href
              if (redactAuthMessage(destination, config, request.secret) !== destination)
                throw new Error('Invalid login URL')
              const id = randomUUID()
              const { promise, resolve } = Promise.withResolvers<BrowserDecision>()
              const cancel = () => resolve('cancel')
              const ipc = application.get('IpcApiService')
              attempt.consent = { id, resolve }
              consentSignal.addEventListener('abort', cancel, { once: true })
              try {
                ipc.send(senderId, 'ai.local_agents.auth_consent', {
                  requestId,
                  promptId: id,
                  prompt: { url: destination, message: redactAuthMessage(message, config, request.secret) }
                })
                const decision = await promise
                if (consentSignal.aborted) return 'cancel'
                if (decision === 'accept') await shell.openExternal(destination)
                return decision
              } finally {
                consentSignal.removeEventListener('abort', cancel)
                attempt.consent = undefined
                ipc.send(senderId, 'ai.local_agents.auth_consent', { requestId, promptId: id })
              }
            }
          : undefined
      },
      signal
    )
    signal.throwIfAborted()
  }

  async cancel(requestId: string, senderId: WindowId | null = null): Promise<void> {
    await this.pending.get(JSON.stringify([senderId, requestId]))?.cancel()
  }

  respondToBrowserConsent(requestId: string, promptId: string, decision: BrowserDecision, senderId: WindowId | null) {
    const consent = this.pending.get(JSON.stringify([senderId, requestId]))?.consent
    if (consent?.id === promptId) consent.resolve(decision)
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
      await Promise.all([...this.pending.values()].map((attempt) => attempt.cancel()))
      await Promise.all(this.usageRequests.values())
    } finally {
      this.pending.clear()
    }
  }
}
