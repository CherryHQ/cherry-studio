import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import type {
  AiUsageRecordAttribution,
  AiUsageRecordAuthMethod,
  AiUsageRecordSourceType
} from '@shared/data/types/aiUsageRecord'
import { eq } from 'drizzle-orm'

import { providerService } from '../ProviderService'

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
  authMethod?: AiUsageRecordAuthMethod
}

export type UsageCredentialReceipt =
  | {
      attribution: 'explicit' | 'matched'
      id: string
      label?: string
      masked: string
    }
  | { attribution: 'auth'; method: AiUsageRecordAuthMethod }
  | { attribution: 'unknown' }

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

export function resolveSourceSnapshot(
  explicit: SourceSnapshot | null | undefined,
  topicId: string | null | undefined,
  sessionId: string | null | undefined
): SourceSnapshot | null {
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
      .all()

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
      .all()

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

function fromCredentialReceipt(receipt: UsageCredentialReceipt, providerName: string | undefined): KeyAttribution {
  if (receipt.attribution === 'explicit' || receipt.attribution === 'matched') {
    return {
      attribution: receipt.attribution,
      providerName,
      keyId: receipt.id,
      label: receipt.label,
      masked: receipt.masked
    }
  }

  return {
    attribution: receipt.attribution,
    providerName,
    ...(receipt.attribution === 'auth' ? { authMethod: receipt.method } : {})
  }
}

export function resolveKeyAttribution(providerId: string, credentialReceipt?: UsageCredentialReceipt): KeyAttribution {
  let providerName: string | undefined
  try {
    const provider = providerService.getByProviderId(providerId)
    providerName = provider.name
  } catch (err) {
    logger.debug('resolveKeyAttribution: provider lookup failed', { providerId, err })
  }

  return credentialReceipt
    ? fromCredentialReceipt(credentialReceipt, providerName)
    : { attribution: 'unknown', providerName }
}
