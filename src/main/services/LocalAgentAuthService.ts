import { createHash, randomUUID } from 'node:crypto'

import { shell } from 'electron'

import { application } from '@application'
import type {
  RuntimeAccountResult,
  RuntimeLoginHost,
  RuntimeLoginRequest,
  SubscriptionUsageResult
} from '@cherrystudio/agent-runtime'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { resolveLocalSessionBinding } from '@main/ai/agentSession/localContext'
import { resolveLocalRuntimeAccount } from '@main/ai/runtime/LocalRuntimeDriver'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  getLocalAgentPreset,
  type LocalAgentAccount,
  type LocalAgentConfiguration,
  type LocalAgentRuntime
} from '@shared/ai/localAgent'
import type { WindowId } from '@shared/ipc/types'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

import { protectLocalAgentEnvironment, resolveLocalAgentCredentials } from './localAgentCredentials'

const AUTH_TIMEOUT_MS = 300_000
type BrowserDecision = Awaited<ReturnType<NonNullable<RuntimeLoginHost['confirmBrowser']>>>
type AuthAttempt = {
  owner: string
  cancel(): Promise<void>
  consent?: { id: string; resolve(decision: BrowserDecision): void }
}

function credentialOwner(config: LocalAgentConfiguration) {
  // Native presets can share a login store across multiple Agent providers.
  return config.presetId ?? config.executableOverride ?? 'custom-acp'
}

function accountId(status: RuntimeAccountResult | undefined) {
  return status?.status === 'signed-in' ? status.account?.id || status.account?.email || undefined : undefined
}

function subscriptionRouteKey(config: LocalAgentRuntime, activeModel?: string) {
  const env = Object.keys(config.env)
    .sort()
    .map((key) => [key, config.env[key]])
  return createHash('sha256')
    .update(
      JSON.stringify([config.providerId, config.account, config.sourceModelId, activeModel ?? config.nativeModel, env])
    )
    .digest('base64url')
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
  private readonly accountGenerations = new Map<string, number>()
  private readonly pending = new Map<string, AuthAttempt>()

  async authenticate(
    requestId: string,
    draft: LocalAgentConfiguration,
    methodId: string,
    options?: Omit<RuntimeLoginRequest, 'methodId'>,
    senderId: WindowId | null = null,
    agentId?: string
  ): Promise<LocalAgentAccount> {
    this.shutdown.signal.throwIfAborted()
    const resolved = agentId ? agentProviderService.getBinding(agentId) : undefined
    const saved = resolved && resolveLocalAgentCredentials(resolved)
    if (agentId && (!saved || !agentService.agentExists(agentId))) throw new Error('Local agent is unavailable')
    const preset = getLocalAgentPreset((saved ?? draft).presetId)
    const declaredMethod = preset?.account?.methods?.find(({ id }) => id === methodId)
    const method = declaredMethod ?? preset?.auth?.methods.find(({ id }) => id === methodId)
    const clearEnvironment = declaredMethod?.form === 'browser' ? (declaredMethod.clearEnv ?? []) : []
    const fields =
      method?.form === 'api-key'
        ? [method.apiKey]
        : method?.form === 'cloud'
          ? [method.apiKey, method.project, method.location]
          : []
    const env = { ...(saved ?? draft).env }
    for (const field of fields) {
      if (Object.hasOwn(draft.env, field)) env[field] = draft.env[field]
    }
    for (const field of clearEnvironment) delete env[field]
    const config = { ...(saved ?? draft), env, account: { methodId } }
    const owner = credentialOwner(config)
    const key = JSON.stringify([senderId, requestId])
    if (this.pending.has(key) || [...this.pending.values()].some((attempt) => attempt.owner === owner))
      throw new Error('Authentication is already in progress')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Authentication timed out')), AUTH_TIMEOUT_MS)
    this.bumpAccountGeneration(owner)
    const attempt: AuthAttempt = {
      owner,
      async cancel() {
        controller.abort(new Error('Authentication cancelled'))
        await work.catch(() => {})
      }
    }
    this.pending.set(key, attempt)
    const work = (async () => {
      await this.run(senderId, requestId, config, { methodId, ...options }, attempt, controller.signal)
      const account = await resolveLocalRuntimeAccount(config)
      const status = await account
        .readAccount?.(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        .catch(() => undefined)
      controller.signal.throwIfAborted()
      if (status?.status === 'signed-out') throw new Error('Authentication did not establish a login')
      const identity = accountId(status)
      const region = method?.form === 'cloud' ? env[method.location] : undefined
      const confirmation: LocalAgentAccount = {
        methodId,
        ...(options?.provider && preset?.providerLogin?.id === methodId && { service: options.provider }),
        ...(region && { region }),
        ...(identity && { accountId: identity })
      }
      if (agentId && resolved) {
        const { encryptedEnv, ...localRuntime } = protectLocalAgentEnvironment(
          { env, clearEnvironment: [...clearEnvironment] },
          agentId
        )
        const updated = agentService.updateAgent(
          agentId,
          { localRuntime },
          {
            localAccount: confirmation,
            encryptedLocalEnv: encryptedEnv,
            expectedLocalProvider: { providerId: resolved.providerId, encryptedEnv: resolved.encryptedEnv }
          }
        )
        if (!updated) throw new Error('Local agent is unavailable')
      }
      return confirmation
    })()
    try {
      return await work
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error
      throw new Error(
        redactAuthMessage(cause instanceof Error ? cause.message : String(cause), config, options?.secret)
      )
    } finally {
      this.bumpAccountGeneration(owner)
      clearTimeout(timer)
      this.pending.delete(key)
    }
  }

  private bumpAccountGeneration(owner: string) {
    this.accountGenerations.set(owner, (this.accountGenerations.get(owner) ?? 0) + 1)
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

  async readSubscriptionUsage(agentId: string, sessionId?: string): Promise<SubscriptionUsageResult> {
    const resolveBinding = () => {
      if (!agentService.agentExists(agentId)) return undefined
      if (!sessionId) {
        const saved = agentProviderService.getBinding(agentId)
        return saved && resolveLocalAgentCredentials(saved)
      }
      if (agentSessionService.getById(sessionId)?.agentId !== agentId) return undefined
      const persisted = resolveLocalSessionBinding(sessionId, agentId)
      if (!persisted) return undefined
      const live = application.get('AgentSessionRuntimeService').getConnectedLocalRuntime(sessionId)
      if (!live) return persisted
      return live.providerId === persisted.providerId ? live : undefined
    }
    const config = resolveBinding()
    if (!config || config.sourceModelViaGateway) return { status: 'unsupported' }
    const sessionModel = () =>
      sessionId
        ? application.get('AgentSessionRuntimeService').getLocalSessionView(sessionId).info?.activeModel?.id
        : undefined
    const activeModel = sessionModel()
    if (config.presetId === minimaxCli.id && !activeModel) return { status: 'unsupported' }
    const runtime = activeModel ? { ...config, nativeModel: activeModel } : config
    const owner = credentialOwner(runtime)
    if ([...this.pending.values()].some((attempt) => attempt.owner === owner) || this.shutdown.signal.aborted)
      return { status: 'unavailable' }
    const generation = this.accountGenerations.get(owner)
    const routeKey = subscriptionRouteKey(config, activeModel)
    const key = JSON.stringify([routeKey, generation, sessionId])
    const existing = this.usageRequests.get(key)
    if (existing) return existing

    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(30_000)])
    const read = async (): Promise<SubscriptionUsageResult> => {
      try {
        const account = await resolveLocalRuntimeAccount(runtime)
        if (!account.readSubscriptionUsage) return { status: 'unsupported' }
        const expectedAccount = config.account?.accountId
        const matchesAccount = async () =>
          !expectedAccount || accountId(await account.readAccount?.(signal)) === expectedAccount
        if (!(await matchesAccount())) return { status: 'unavailable' }
        const result = await account.readSubscriptionUsage(signal)
        if (!(await matchesAccount())) return { status: 'unavailable' }
        const current = resolveBinding()
        const currentModel = sessionModel()
        if (
          signal.aborted ||
          generation !== this.accountGenerations.get(owner) ||
          !current ||
          current.sourceModelViaGateway ||
          (current.presetId === minimaxCli.id && !currentModel) ||
          subscriptionRouteKey(current, currentModel) !== routeKey
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
