import type { LocalClaudeLaunch } from '@cherrystudio/agent-runtime-claude-code'
import { claudeCli, claudeModelProfile, scheduledClaudeEnvironment } from '@cherrystudio/agent-runtime-claude-code/cli'
import { modelService } from '@data/services/ModelService'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { stripClaudeContextMarker } from '@shared/utils/model'

import { requireInstallation, resolveCliProgram } from '../cli/cliProgram'

function configuredContextWindow(config: LocalAgentConfiguration) {
  const { nativeModel, sourceModelId, sourceModelViaGateway } = config
  if (!nativeModel || !sourceModelId || !sourceModelViaGateway) return
  const { providerId, modelId } = parseUniqueModelId(sourceModelId)
  try {
    const model = modelService.getByKey(providerId, modelId)
    const address = formatGatewayModelId(providerId, model.apiModelId ?? modelId)
    if ((nativeModel === address || stripClaudeContextMarker(nativeModel) === address) && model.contextWindow)
      return { model: nativeModel, tokens: model.contextWindow }
  } catch {
    return undefined
  }
  return undefined
}

export async function resolveClaudeLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'scheduled-chat' | 'models'
) {
  const program = await resolveCliProgram(config, purpose === 'models' ? 'models' : 'session', signal, {
    profile: claudeModelProfile,
    componentId: claudeCli.executable,
    windowsShell: claudeCli.windowsShell,
    ...(purpose === 'scheduled-chat' && {
      scheduledEnvironment: { target: claudeCli.modelConfig.target, merge: scheduledClaudeEnvironment }
    })
  })
  return {
    installation: requireInstallation(program.installation, claudeCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    ...(program.nativeModel && { nativeModel: program.nativeModel }),
    ...(purpose !== 'models' && { contextWindow: configuredContextWindow(config) })
  } satisfies LocalClaudeLaunch & {
    env: Record<string, string>
    nativeModel?: string
    contextWindow?: { model: string; tokens: number }
  }
}
