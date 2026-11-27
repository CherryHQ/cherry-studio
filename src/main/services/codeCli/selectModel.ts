import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { t } from '@main/i18n'
import { getEnvironmentValue } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { getLocalAgentProtocol } from '@shared/ai/localAgent'
import { getLocalAgentModelStorage, LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { UniqueModelId } from '@shared/data/types/model'
import { getCliConfigTargets } from '@shared/utils/cliConfig'
import type { CliConfigTarget, CliConfigWriteFile, FileConfiguredCli } from '@shared/utils/cliConfig'

import { readNativeModelConfig, updateNativeModelConfig } from './nativeModelConfig'

function hasConfigOverrides(
  overrides: (typeof LOCAL_AGENT_MODEL_CONFIG)[string]['overrides'],
  env: Record<string, string>,
  shellEnv: Record<string, string | undefined>
) {
  const specific = typeof overrides === 'function' ? overrides(process.platform) : overrides
  return ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', ...specific].some((key) => {
    const override = getEnvironmentValue(env, key)
    return override !== undefined && override !== getEnvironmentValue(shellEnv, key)
  })
}

export async function selectLocalAgentModel(
  agentId: string,
  nativeModel?: string,
  selection: {
    sourceModelId?: UniqueModelId
    sourceModelViaGateway?: boolean
    files?: CliConfigWriteFile[]
    expectedFiles?: { target: CliConfigTarget; content: string | null }[]
  } = {}
) {
  const agent = agentService.getAgent(agentId)
  const config = agent?.configuration?.localRuntime
  const native = getLocalAgentModelStorage(config?.presetId)
  if (!agent || agent.type !== 'local' || !config || !native) {
    throw new Error(t('code_cli.model.unsupported'))
  }
  if (
    native.type === 'agent' ||
    (native.nativeSelection === 'agent' && !config.sourceModelId && !selection.sourceModelId)
  ) {
    const gatewayAtLaunch =
      native.type === 'agent' &&
      native.gatewayModelEndpoint &&
      !config.executableOverride &&
      selection.sourceModelViaGateway
    if (
      ((selection.sourceModelId || selection.sourceModelViaGateway) &&
        (!gatewayAtLaunch || !selection.sourceModelId || nativeModel !== undefined)) ||
      selection.files?.length ||
      selection.expectedFiles?.length
    )
      throw new Error(t('code_cli.model.unsupported'))
    const updated = agentService.updateAgent(agentId, {
      configuration: {
        localRuntime: {
          nativeModel,
          sourceModelId: selection.sourceModelId,
          sourceModelViaGateway: gatewayAtLaunch ? true : undefined
        }
      }
    })
    if (!updated) throw new Error(t('code_cli.model.agent_missing'))
    return updated
  }
  const shellEnv = await getRawShellEnv()
  if (hasConfigOverrides(native.overrides, config.env, shellEnv)) {
    throw new Error(t('code_cli.model.environment_mismatch'))
  }
  if (selection.sourceModelId && !selection.files?.length) throw new Error(t('code_cli.model.provider_config_missing'))
  if (config.sourceModelId && !selection.sourceModelId && !selection.files?.length) {
    throw new Error(t('code_cli.model.provider_clear_required'))
  }
  const updated = await application.get('CodeCliService').updateConfigFiles(
    native.tool,
    getCliConfigTargets(native.tool),
    (currentFiles) => {
      if (
        selection.expectedFiles?.some(
          (file) => currentFiles.find((current) => current.target === file.target)?.content !== file.content
        )
      ) {
        throw new Error(t('code_cli.model.config_changed'))
      }
      const current = currentFiles.find((file) => file.target === native.target)!

      const files = selection.files?.map((file) => ({ ...file })) ?? []
      const primary = files.find((file) => file.target === native.target)
      if (selection.sourceModelId) {
        if (!primary || primary.content === undefined) throw new Error(t('code_cli.model.model_config_missing'))
        nativeModel = readNativeModelConfig(native.target, primary.content)
        if (!nativeModel) throw new Error(t('code_cli.model.default_missing'))
      } else {
        const model = native.nativeSelection === 'agent' ? undefined : nativeModel
        const content = updateNativeModelConfig(native.target, primary?.content ?? current.content, model)
        if (primary) primary.content = content
        else files.push({ target: native.target, content })
      }
      return files
    },
    () => {
      // Re-read after queued I/O so an enable or environment edit is not overwritten.
      const current = agentService.getAgent(agentId)?.configuration?.localRuntime
      if (!current) throw new Error(t('code_cli.model.agent_missing'))
      if (current.presetId !== config.presetId) throw new Error(t('code_cli.model.config_changed'))
      if (hasConfigOverrides(native.overrides, current.env, shellEnv))
        throw new Error(t('code_cli.model.environment_mismatch'))
      const updated = agentService.updateAgent(agentId, {
        configuration: {
          localRuntime: {
            nativeModel,
            sourceModelId: selection.sourceModelId,
            sourceModelViaGateway: selection.sourceModelId ? selection.sourceModelViaGateway : undefined
          }
        }
      })
      if (!updated) throw new Error(t('code_cli.model.agent_missing'))
      return updated
    }
  )
  return updated
}

export function syncLocalAgentConfigModel(
  tool: FileConfiguredCli,
  files: CliConfigWriteFile[],
  preserveModelSource = false,
  shellEnv: Record<string, string | undefined> = {}
): void {
  const entry = Object.entries(LOCAL_AGENT_MODEL_CONFIG).find(([, config]) => config.tool === tool)
  if (!entry) return
  const [presetId, native] = entry
  const file = files.find((file) => file.target === native.target)
  const agent = agentService
    .listAgents()
    .agents.find((agent) => agent.configuration?.localRuntime?.presetId === presetId)
  const config = agent?.configuration?.localRuntime
  if (
    !agent ||
    !config ||
    ((native.nativeSelection === 'agent' || getLocalAgentProtocol(presetId) === 'acp') && !config.sourceModelId) ||
    hasConfigOverrides(native.overrides, config.env, shellEnv)
  )
    return
  const nativeModel =
    file?.content === undefined ? config.nativeModel : readNativeModelConfig(native.target, file.content)
  const preserveSource = preserveModelSource && nativeModel === config.nativeModel
  agentService.updateAgent(agent.id, {
    configuration: {
      localRuntime: {
        nativeModel: native.nativeSelection === 'agent' && !preserveSource ? undefined : nativeModel,
        sourceModelViaGateway: preserveSource ? config.sourceModelViaGateway : undefined,
        sourceModelId: preserveSource ? config.sourceModelId : undefined
      }
    }
  })
}
