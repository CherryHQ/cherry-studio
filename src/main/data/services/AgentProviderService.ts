import { isDeepStrictEqual } from 'node:util'

import { eq, inArray } from 'drizzle-orm'

import { application } from '@application'
import { agentProviderBindingTable as bindings, agentProviderTable as providers } from '@data/db/schemas/agentProvider'
import type { DbType } from '@data/db/types'
import {
  getLocalAgentModelSelection,
  type LocalAgentAccount,
  LocalAgentAccountSchema,
  LocalAgentModelSelectionSchema,
  type LocalAgentRuntime,
  localAgentModelConfig,
  StoredLocalAgentConfigurationSchema
} from '@shared/ai/localAgent'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import type { UpdateAgentDto } from '@shared/data/api/schemas/agents'
import { getLocalAgentPreset } from '@shared/data/presets/localAgents'
import { isSensitiveKey } from '@shared/utils/redaction'

export type LocalAgentBindingPatch = NonNullable<UpdateAgentDto['localRuntime']> & {
  account?: LocalAgentAccount | null
  encryptedEnv?: string | null
}
export type LocalAgentProviderPrecondition = Pick<LocalAgentRuntime, 'providerId'> & {
  encryptedEnv: string | null
}

type ProviderRow = typeof providers.$inferSelect
type BindingRow = typeof bindings.$inferSelect
type ReadDb = Pick<DbType, 'select'>

function providerConfiguration(provider: ProviderRow) {
  return {
    presetId: provider.presetId ?? undefined,
    executableOverride: provider.executable ?? undefined,
    args: provider.args ?? [],
    env: provider.env ?? {},
    account: provider.account ? LocalAgentAccountSchema.parse(provider.account) : undefined
  }
}

function bindingConfiguration(binding: BindingRow, provider: ProviderRow): LocalAgentRuntime {
  return {
    ...providerConfiguration(provider),
    ...localAgentModelConfig(LocalAgentModelSelectionSchema.parse(binding.model)),
    enabled: binding.enabled,
    browserControl: binding.browserControl ?? undefined,
    providerId: binding.providerId
  }
}

class AgentProviderService {
  getBinding(agentId: string) {
    return this.getBindingTx(application.get('DbService').getDb(), agentId)
  }

  getBindingTx(tx: ReadDb, agentId: string): (LocalAgentRuntime & LocalAgentProviderPrecondition) | undefined {
    const row = this.bindingRows(tx, [agentId])[0]
    return row
      ? {
          ...bindingConfiguration(row.binding, row.provider),
          encryptedEnv: row.provider.encryptedEnv
        }
      : undefined
  }

  getProjection(agentId: string): LocalAgentRuntime | undefined {
    return this.getProjectionTx(application.get('DbService').getDb(), agentId)
  }

  getProjectionTx(tx: ReadDb, agentId: string): LocalAgentRuntime | undefined {
    const row = this.bindingRows(tx, [agentId])[0]
    return row ? bindingConfiguration(row.binding, row.provider) : undefined
  }

  isEnabledTx(tx: ReadDb, agentId: string): boolean {
    return (
      tx.select({ enabled: bindings.enabled }).from(bindings).where(eq(bindings.agentId, agentId)).get()?.enabled ===
      true
    )
  }

  getProjectionsTx(tx: ReadDb, agentIds: string[]): Map<string, LocalAgentRuntime> {
    return new Map(
      this.bindingRows(tx, agentIds).map(({ binding, provider }) => [
        binding.agentId,
        bindingConfiguration(binding, provider)
      ])
    )
  }

  getProviderConfiguration(providerId: string) {
    return this.getProviderConfigurationTx(application.get('DbService').getDb(), providerId)
  }

  getProviderConfigurationTx(tx: ReadDb, providerId: string) {
    const provider = this.getProviderTx(tx, providerId)
    return provider ? { ...providerConfiguration(provider), encryptedEnv: provider.encryptedEnv } : undefined
  }

  setBindingTx(
    tx: Pick<DbType, 'select' | 'insert' | 'update'>,
    agentId: string,
    patch: LocalAgentBindingPatch,
    expected?: LocalAgentProviderPrecondition
  ): LocalAgentRuntime {
    const { providerId, account, clearEnvironment, encryptedEnv, ...fields } = patch
    const existing = this.bindingRows(tx, [agentId])[0]
    if (
      expected &&
      (existing?.provider.id !== expected.providerId || existing.provider.encryptedEnv !== expected.encryptedEnv)
    ) {
      throw DataApiErrorFactory.conflict('Local agent connection changed during sign-in', 'Agent provider')
    }
    const selected = providerId ? this.getProviderTx(tx, providerId) : existing?.provider
    if (providerId && !selected) throw DataApiErrorFactory.notFound('Agent provider', providerId)
    const current = selected ? providerConfiguration(selected) : undefined
    if (Object.keys(fields.env ?? {}).some(isSensitiveKey) || clearEnvironment?.some(isSensitiveKey)) {
      throw DataApiErrorFactory.invalidOperation(
        'save local settings',
        'Protected environment requires the local Agent settings command'
      )
    }
    const env = { ...(fields.env ?? current?.env) }
    for (const key of clearEnvironment ?? []) delete env[key]
    const previousModel =
      existing && selected?.id === existing.provider.id ? localAgentModelConfig(existing.binding.model) : {}
    const validation = StoredLocalAgentConfigurationSchema.safeParse({
      presetId: current?.presetId,
      executableOverride: current?.executableOverride,
      ...previousModel,
      browserControl: existing?.binding.browserControl ?? undefined,
      ...fields,
      args: fields.args ?? current?.args ?? [],
      enabled: fields.enabled ?? existing?.binding.enabled ?? false,
      env
    })
    if (!validation.success) throw toDataApiError(validation.error)
    const config = validation.data
    if (Boolean(config.sourceModelViaGateway) !== Boolean(config.sourceModelId)) {
      throw DataApiErrorFactory.invalidOperation('save local model', 'Invalid Cherry model selection')
    }
    if (config.sourceModelId && config.nativeModel) {
      throw DataApiErrorFactory.invalidOperation('save local model', 'Select one model source')
    }
    const preset = getLocalAgentPreset(config.presetId)
    const args = !config.executableOverride && preset && isDeepStrictEqual(config.args, preset.args) ? [] : config.args
    const entries = Object.entries(env).filter(([key, value]) => preset?.env?.[key] !== value)
    const ordinaryEnv = Object.fromEntries(entries)
    const launch = {
      presetId: config.presetId ?? null,
      executable: config.executableOverride ?? null,
      args: args.length ? args : null,
      env: entries.length ? ordinaryEnv : null
    }
    const launchUnchanged =
      selected &&
      isDeepStrictEqual(launch, {
        presetId: selected.presetId,
        executable: selected.executable,
        args: selected.args,
        env: selected.env
      })
    const sameTarget =
      config.presetId === current?.presetId && config.executableOverride === current?.executableOverride
    const nextEncryptedEnv =
      encryptedEnv === undefined ? (sameTarget ? (selected?.encryptedEnv ?? null) : null) : encryptedEnv
    const launchChanged = !launchUnchanged || nextEncryptedEnv !== selected?.encryptedEnv
    const previousAccount = selected?.account ?? null
    const launchAccount = sameTarget && previousAccount ? { methodId: previousAccount.methodId } : null
    const nextAccount: LocalAgentAccount | null =
      account === undefined ? (launchChanged ? launchAccount : previousAccount) : account
    const accountChanged = !isDeepStrictEqual(selected?.account ?? null, nextAccount)
    const signingIn = expected && sameTarget && account !== undefined
    let provider = selected
    const providerValues = { ...launch, encryptedEnv: nextEncryptedEnv, account: nextAccount }
    if (!provider || (!launchUnchanged && !signingIn)) {
      provider = tx.insert(providers).values(providerValues).returning().get()
    } else if (launchChanged || accountChanged) {
      provider = tx.update(providers).set(providerValues).where(eq(providers.id, provider.id)).returning().get()
    }

    const binding = {
      agentId,
      providerId: provider.id,
      enabled: config.enabled,
      browserControl: config.browserControl ?? null,
      model: getLocalAgentModelSelection(config)
    }
    tx.insert(bindings).values(binding).onConflictDoUpdate({ target: bindings.agentId, set: binding }).run()
    return bindingConfiguration(binding, provider)
  }

  private bindingRows(tx: ReadDb, agentIds: string[]) {
    if (!agentIds.length) return []
    return tx
      .select({ binding: bindings, provider: providers })
      .from(bindings)
      .innerJoin(providers, eq(providers.id, bindings.providerId))
      .where(inArray(bindings.agentId, agentIds))
      .all()
  }

  private getProviderTx(tx: ReadDb, providerId: string) {
    return tx.select().from(providers).where(eq(providers.id, providerId)).get()
  }
}

export const agentProviderService = new AgentProviderService()
