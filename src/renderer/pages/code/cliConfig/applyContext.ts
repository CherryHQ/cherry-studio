import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import { sanitizeCliConfigBlob } from './adapters'
import { getClaudeContextModelId, hasClaudeDetailedModels } from './claudeModels'

export function parseConfiguredModelId(
  // Wide on purpose: tolerates legacy '' and corrupt dev-profile values.
  modelId: string | null | undefined
): { uniqueModelId: UniqueModelId; providerId: string; modelId: string } | null {
  const result = UniqueModelIdSchema.safeParse(modelId)
  if (!result.success) {
    return null
  }
  return { uniqueModelId: result.data, ...parseUniqueModelId(result.data) }
}

export function resolveCliConfigApplyContext(
  cliTool: CodeCli,
  providerId: string,
  providerConfig: { modelId?: string | null; config?: Record<string, unknown> } | undefined
): { modelId: UniqueModelId; providerId: string; rawModelId: string; writePrimaryModel: boolean } | null {
  const config = sanitizeCliConfigBlob(cliTool, providerConfig?.config ?? {})
  if (cliTool === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config)) {
    const detailedModelId = getClaudeContextModelId(providerId, config)
    const parsedDetailedModelId = parseConfiguredModelId(detailedModelId)
    if (detailedModelId && parsedDetailedModelId) {
      return {
        modelId: parsedDetailedModelId.uniqueModelId,
        providerId: parsedDetailedModelId.providerId,
        rawModelId: parsedDetailedModelId.modelId,
        writePrimaryModel: false
      }
    }
  }

  const parsedModelId = parseConfiguredModelId(providerConfig?.modelId)
  if (!parsedModelId) return null
  return {
    modelId: parsedModelId.uniqueModelId,
    providerId: parsedModelId.providerId,
    rawModelId: parsedModelId.modelId,
    writePrimaryModel: true
  }
}
