import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { getAgentSessionHead } from '@data/services/agentSessionMessageTree'
import { resolveLocalAgentCredentials } from '@main/services/localAgentCredentials'
import {
  getLocalAgentModelSelection,
  localAgentModelConfig,
  type LocalAgentAccount,
  type LocalAgentConfiguration,
  type LocalAgentModelSelection,
  LocalAgentModelSelectionSchema
} from '@shared/ai/localAgent'

export type LocalLaunchTarget = {
  providerId: string
  model: LocalAgentModelSelection
  env: LocalAgentConfiguration['env']
  account?: LocalAgentAccount
  encryptedEnv: string | null
} & ({ kind: 'new'; replaces?: AgentSessionContextRow } | { kind: 'resume'; context: AgentSessionContextRow })

function resolveLocalContextTx(tx: DbOrTx, sessionId: string, head?: string) {
  const anchor = head ?? getAgentSessionHead(tx, sessionId)
  const context = anchor && contexts.branchTx(tx, sessionId, anchor)
  if (!context) return
  const backend = contexts.backendTx(tx, context.backendId)
  if (backend.locator.kind === 'local' && backend.localProviderId) {
    return { context, providerId: backend.localProviderId }
  }
  return undefined
}

export function resolveLocalContext(sessionId: string, head?: string) {
  return resolveLocalContextTx(application.get('DbService').getDb(), sessionId, head)
}

export function resolveLocalLaunch(sessionId: string, agentId: string, head?: string) {
  const selected = resolveLocalContext(sessionId, head)
  const binding = agentProviderService.getProjection(agentId)
  if (!binding?.enabled) return
  const providerId = selected?.providerId ?? binding.providerId
  const provider = agentProviderService.getProviderConfiguration(providerId)
  if (!provider) return
  const model =
    selected && providerId !== binding.providerId
      ? LocalAgentModelSelectionSchema.parse(selected.context.localModel)
      : getLocalAgentModelSelection(binding)
  const identity = {
    providerId,
    model,
    env: provider.env,
    account: provider.account,
    encryptedEnv: provider.encryptedEnv
  }
  const target: LocalLaunchTarget = selected
    ? { ...identity, kind: 'resume', context: selected.context }
    : { ...identity, kind: 'new' }
  return {
    target,
    config: {
      ...resolveLocalAgentCredentials(provider),
      ...localAgentModelConfig(model),
      enabled: binding.enabled,
      browserControl: binding.browserControl,
      providerId
    }
  }
}

export function resolveLocalSessionBinding(sessionId: string, agentId: string, head?: string) {
  return resolveLocalLaunch(sessionId, agentId, head)?.config
}

export function localBindingMatches(
  target: LocalLaunchTarget,
  binding: ReturnType<typeof agentProviderService.getBinding>,
  browserControl: LocalAgentConfiguration['browserControl'],
  tx: DbOrTx = application.get('DbService').getDb()
): boolean {
  if (!binding?.enabled || binding.browserControl !== browserControl) return false
  const currentProvider = target.providerId === binding.providerId
  const provider = currentProvider ? binding : agentProviderService.getProviderConfigurationTx(tx, target.providerId)
  if (
    !provider ||
    target.encryptedEnv !== provider.encryptedEnv ||
    !isDeepStrictEqual(target.account, provider.account) ||
    !isDeepStrictEqual(target.env, provider.env)
  )
    return false
  if (currentProvider) return isDeepStrictEqual(target.model, getLocalAgentModelSelection(binding))
  const context = target.kind === 'resume' ? target.context : target.replaces
  return !!context && isDeepStrictEqual(target.model, context.localModel)
}

export function localContext(
  sessionId: string,
  agentId: string,
  anchorMessageId: string,
  target: LocalLaunchTarget,
  browserControl: LocalAgentConfiguration['browserControl'],
  nativeId?: string,
  provisional?: { id: string; nativeConfirmed: boolean }
) {
  return application.get('DbService').withWriteTx((tx) => {
    const binding = agentProviderService.getBindingTx(tx, agentId)
    if (!localBindingMatches(target, binding, browserControl, tx)) return
    const existing = contexts.branchTx(tx, sessionId, anchorMessageId)
    const backend = contexts.ensureLocalBackendTx(tx, target.providerId)
    const replaces = target.kind === 'new' ? target.replaces : undefined
    if (replaces) {
      if (existing?.id !== replaces.id || existing.backendId !== backend.id) return
      contexts.detachBranchTx(tx, existing.id)
    } else if (existing) {
      if (existing.backendId !== backend.id) throw new Error('The selected branch belongs to another runtime backend')
      if (!nativeId || !existing.nativeThreadId || existing.nativeThreadId === nativeId) {
        return isDeepStrictEqual(existing.localModel, target.model)
          ? existing
          : contexts.setLocalModelTx(tx, existing.id, target.model)
      }
    }
    return contexts.reserveBranchTx(tx, {
      id: provisional?.id,
      sessionId,
      backendId: backend.id,
      anchorMessageId: replaces?.anchorMessageId ?? anchorMessageId,
      nativeThreadId: nativeId,
      bindingState: nativeId && provisional?.nativeConfirmed !== false ? 'bound' : 'pending',
      localModel: target.model,
      ...(replaces && { checkpointMapping: { referenceHistory: true } })
    })
  })
}

export function bindLocalContext(contextId: string, nativeId: string) {
  return contexts.bindContext(contextId, nativeId)
}
