import { isDeepStrictEqual } from 'node:util'

import { safeStorage } from 'electron'

import { agentProviderService } from '@data/services/AgentProviderService'
import { LocalAgentConfigurationSchema } from '@shared/ai/localAgent'
import { isSensitiveKey } from '@shared/utils/redaction'

function decodeEnvironment(encryptedEnv: string | null | undefined) {
  if (!encryptedEnv) return {}
  const text = safeStorage.decryptString(Buffer.from(encryptedEnv, 'base64'))
  return LocalAgentConfigurationSchema.shape.env.parse(JSON.parse(text))
}

export function resolveLocalAgentCredentials<T extends { env: Record<string, string>; encryptedEnv: string | null }>(
  provider: T
): Omit<T, 'encryptedEnv'> {
  const { encryptedEnv, ...config } = provider
  return { ...config, env: { ...config.env, ...decodeEnvironment(encryptedEnv) } }
}

export function protectLocalAgentEnvironment<
  T extends {
    env?: Record<string, string>
    providerId?: string
    presetId?: string
    executableOverride?: string
    clearEnvironment?: string[]
  }
>(settings: T, agentId?: string): T & { encryptedEnv?: string | null } {
  const entries = Object.entries(settings.env ?? {})
  const secrets = entries.filter(([key]) => isSensitiveKey(key))
  const clearSecrets = settings.clearEnvironment?.filter(isSensitiveKey) ?? []
  if (!secrets.length && !clearSecrets.length) return settings

  const stored = settings.providerId
    ? agentProviderService.getProviderConfiguration(settings.providerId)
    : agentId
      ? agentProviderService.getBinding(agentId)
      : undefined
  const targetChanged =
    (Object.hasOwn(settings, 'presetId') && settings.presetId !== stored?.presetId) ||
    (Object.hasOwn(settings, 'executableOverride') && settings.executableOverride !== stored?.executableOverride)
  const currentEnvelope = targetChanged ? null : stored?.encryptedEnv
  const previous = decodeEnvironment(currentEnvelope)
  const protectedEnv = { ...previous, ...Object.fromEntries(secrets) }
  for (const key of clearSecrets) delete protectedEnv[key]

  let encryptedEnv = currentEnvelope ?? null
  if (!isDeepStrictEqual(previous, protectedEnv)) {
    encryptedEnv = Object.keys(protectedEnv).length ? encryptEnvironment(protectedEnv) : null
  }
  return {
    ...settings,
    env: settings.env && Object.fromEntries(entries.filter(([key]) => !isSensitiveKey(key))),
    clearEnvironment: settings.clearEnvironment?.filter((key) => !isSensitiveKey(key)),
    encryptedEnv
  }
}

function encryptEnvironment(env: Record<string, string>): string {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('Secure storage is unavailable for local Agent credentials')
  }
  return safeStorage.encryptString(JSON.stringify(env)).toString('base64')
}
