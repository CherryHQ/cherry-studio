import { resolveGatewayModelAddressSnapshot } from '@main/features/apiGateway/utils/models'
import { parseUniqueModelId } from '@shared/data/types/model'

import { isTrustedClaudeSlot } from './environment'
import type { ClaudeCodeGatewayModelSlot } from './settingsBuilder'

/** Only models the internal gateway admits can consume the shared process budget. */
export function resolveGatewayBudgetSlots(addresses: readonly string[]): ClaudeCodeGatewayModelSlot[] {
  return [...new Set(addresses)].flatMap((address) => {
    try {
      const { provider, model, uniqueModelId } = resolveGatewayModelAddressSnapshot(address, true)
      return [
        {
          providerId: provider.id,
          modelId: parseUniqueModelId(uniqueModelId).modelId,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          trusted: isTrustedClaudeSlot(provider, model)
        }
      ]
    } catch {
      return []
    }
  })
}

export function gatewayPinAddresses(env: Record<string, string | undefined>): string[] {
  return [env.CLAUDE_CODE_SUBAGENT_MODEL, env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL]
    .map((address) => address?.trim())
    .filter((address): address is string => Boolean(address?.includes(':')))
}
