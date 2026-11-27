import { agentService } from '@data/services/AgentService'
import { t } from '@main/i18n'
import { getLocalAgentLaunchBinding, getLocalAgentModelStorage } from '@shared/ai/localAgentModel'
import type { UniqueModelId } from '@shared/data/types/model'

export async function selectLocalAgentModel(
  agentId: string,
  nativeModel?: string,
  selection: { sourceModelId?: UniqueModelId; sourceModelViaGateway?: boolean } = {}
) {
  const agent = agentService.getAgent(agentId)
  const runtime = agent?.localRuntime
  const storage = getLocalAgentModelStorage(runtime?.presetId)
  if (agent?.type !== 'local' || !runtime || !storage) throw new Error(t('code_cli.model.unsupported'))

  if (selection.sourceModelId || selection.sourceModelViaGateway) {
    const supportsCherryModel =
      !runtime.executableOverride &&
      (getLocalAgentLaunchBinding(runtime.presetId) || (storage.type === 'agent' && storage.gatewayModelEndpoint))
    if (
      !supportsCherryModel ||
      !selection.sourceModelId ||
      !selection.sourceModelViaGateway ||
      nativeModel !== undefined
    )
      throw new Error(t('code_cli.model.cherry_model_unsupported'))
  }
  const updated = agentService.updateAgent(agentId, {
    localRuntime: {
      nativeModel,
      sourceModelId: selection.sourceModelId,
      sourceModelViaGateway: selection.sourceModelId ? true : undefined
    }
  })
  if (!updated) throw new Error(t('code_cli.model.agent_missing'))
  return updated
}
