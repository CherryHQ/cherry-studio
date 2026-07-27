import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import type { AiUsageRecordAttribution, AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import { eq } from 'drizzle-orm'

import { type ProviderApiKeySnapshot, providerService } from '../ProviderService'
import { maskApiKeyForSnapshot } from '../utils/apiKeySnapshot'

const logger = loggerService.withContext('DataApi:AiUsageRecordSnapshots')

export type SourceSnapshot = {
  type: AiUsageRecordSourceType
  id: string
  name: string | null
  icon: string | null
}

export interface KeyAttribution {
  attribution: AiUsageRecordAttribution
  providerName?: string
  keyId?: string
  label?: string
  masked?: string
}

const AUTH_CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['iam-aws', 'iam-gcp', 'iam-azure'])

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

export async function resolveSourceSnapshot(
  explicit: SourceSnapshot | null | undefined,
  topicId: string | null | undefined,
  sessionId: string | null | undefined
): Promise<SourceSnapshot | null> {
  if (explicit) return explicit

  const db = application.get('DbService').getDb()
  if (topicId) {
    const [row] = db
      .select({
        assistantId: topicTable.assistantId,
        assistantName: assistantTable.name,
        assistantIcon: assistantTable.emoji
      })
      .from(topicTable)
      .leftJoin(assistantTable, eq(topicTable.assistantId, assistantTable.id))
      .where(eq(topicTable.id, topicId))
      .limit(1)

    if (row?.assistantId) {
      return {
        type: 'assistant',
        id: row.assistantId,
        name: row.assistantName ?? null,
        icon: row.assistantIcon ?? null
      }
    }
  }

  if (sessionId) {
    const [row] = db
      .select({
        agentId: agentSessionTable.agentId,
        agentName: agentTable.name,
        agentConfiguration: agentTable.configuration
      })
      .from(agentSessionTable)
      .leftJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
      .where(eq(agentSessionTable.id, sessionId))
      .limit(1)

    if (row?.agentId) {
      return {
        type: 'agent',
        id: row.agentId,
        name: row.agentName ?? null,
        icon: getAgentAvatar(row.agentConfiguration) ?? null
      }
    }
  }

  return null
}

export async function resolveKeyAttribution(
  providerId: string,
  apiKeySnapshot?: ProviderApiKeySnapshot
): Promise<KeyAttribution> {
  let providerName: string | undefined
  try {
    const provider = providerService.getByProviderId(providerId)
    providerName = provider.name
    if (apiKeySnapshot) {
      return {
        attribution: 'exact',
        providerName,
        keyId: apiKeySnapshot.id,
        label: apiKeySnapshot.label,
        masked: apiKeySnapshot.masked
      }
    }

    const authType = provider.authType
    if (AUTH_CREDENTIAL_TYPES.has(authType)) {
      return { attribution: 'auth', providerName }
    }

    let allKeys: Awaited<ReturnType<typeof providerService.getApiKeys>>
    try {
      allKeys = provider.apiKeys.length > 0 ? providerService.getApiKeys(providerId) : []
    } catch (err) {
      logger.warn('resolveKeyAttribution: getApiKeys failed', { providerId, err })
      return { attribution: 'none', providerName }
    }
    const enabled = allKeys.filter((key) => key.isEnabled)

    if (enabled.length === 0) {
      return authType === 'oauth' ? { attribution: 'auth', providerName } : { attribution: 'none', providerName }
    }

    if (enabled.length === 1) {
      const key = enabled[0]
      return {
        attribution: 'exact',
        providerName,
        keyId: key.id,
        label: key.label,
        masked: maskApiKeyForSnapshot(key.key)
      }
    }

    const lastUsedKeyId = providerService.getLastUsedApiKeyId(providerId)
    if (lastUsedKeyId) {
      const key = allKeys.find((entry) => entry.id === lastUsedKeyId)
      if (key) {
        return {
          attribution: 'rotation',
          providerName,
          keyId: key.id,
          label: key.label,
          masked: maskApiKeyForSnapshot(key.key)
        }
      }
    }
    return { attribution: 'none', providerName }
  } catch (err) {
    if (apiKeySnapshot) {
      return {
        attribution: 'exact',
        providerName,
        keyId: apiKeySnapshot.id,
        label: apiKeySnapshot.label,
        masked: apiKeySnapshot.masked
      }
    }

    logger.debug('resolveKeyAttribution: provider lookup failed', { providerId, err })
    return { attribution: 'none' }
  }
}
