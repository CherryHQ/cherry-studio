import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import { sanitizeCliConfigBlob } from './adapters'
import { getClaudeContextModelId, hasClaudeDetailedModels } from './claudeModels'

export function parseConfiguredModelId(modelId: string | undefined): { providerId: string; modelId: string } | null {
  const result = UniqueModelIdSchema.safeParse(modelId)
  if (!result.success) {
    return null
  }
  return parseUniqueModelId(result.data)
}

export function resolveCliConfigApplyContext(
  cliTool: CodeCli,
  providerId: string,
  providerConfig: { modelId?: string; config?: Record<string, unknown> } | undefined
): { modelId: UniqueModelId; providerId: string; rawModelId: string; writePrimaryModel: boolean } | null {
  const config = sanitizeCliConfigBlob(cliTool, providerConfig?.config ?? {})
  if (cliTool === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config)) {
    const detailedModelId = getClaudeContextModelId(providerId, config)
    const parsedDetailedModelId = parseConfiguredModelId(detailedModelId)
    if (detailedModelId && parsedDetailedModelId) {
      return {
        modelId: detailedModelId,
        providerId: parsedDetailedModelId.providerId,
        rawModelId: parsedDetailedModelId.modelId,
        writePrimaryModel: false
      }
    }
  }

  const parsedModelId = parseConfiguredModelId(providerConfig?.modelId)
  if (!providerConfig?.modelId || !parsedModelId) return null
  return {
    modelId: providerConfig.modelId as UniqueModelId,
    providerId: parsedModelId.providerId,
    rawModelId: parsedModelId.modelId,
    writePrimaryModel: true
  }
}
