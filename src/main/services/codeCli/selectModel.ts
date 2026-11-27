import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { t } from '@main/i18n'
import { getEnvironmentValue } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { getLocalAgentProtocol } from '@shared/ai/localAgent'
import {
  getLocalAgentLaunchBinding,
  getLocalAgentModelStorage,
  LOCAL_AGENT_MODEL_CONFIG
} from '@shared/ai/localAgentModel'
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
    expectedFiles?: { target: CliConfigTarget; content: string | null }[]
  } = {}
) {
  const agent = agentService.getAgent(agentId)
  const config = agent?.configuration?.localRuntime
  const native = getLocalAgentModelStorage(config?.presetId)
  if (!agent || agent.type !== 'local' || !config || !native) {
    throw new Error(t('code_cli.model.unsupported'))
  }
  if (selection.sourceModelId || selection.sourceModelViaGateway) {
    // A Cherry model lives only on the Agent; each launch binds it without touching CLI files.
    const binds =
      !config.executableOverride &&
      (getLocalAgentLaunchBinding(config.presetId) || (native.type === 'agent' && native.gatewayModelEndpoint))
    if (
      !binds ||
      !selection.sourceModelId ||
      !selection.sourceModelViaGateway ||
      nativeModel !== undefined ||
      selection.expectedFiles?.length
    )
      throw new Error(t('code_cli.model.cherry_model_unsupported'))
    const updated = agentService.updateAgent(agentId, {
      configuration: {
        localRuntime: { nativeModel: undefined, sourceModelId: selection.sourceModelId, sourceModelViaGateway: true }
      }
    })
    if (!updated) throw new Error(t('code_cli.model.agent_missing'))
    return updated
  }
  if (native.type === 'agent' || native.nativeSelection === 'agent') {
    if (selection.expectedFiles?.length) throw new Error(t('code_cli.model.unsupported'))
    const updated = agentService.updateAgent(agentId, {
      configuration: { localRuntime: { nativeModel, sourceModelId: undefined, sourceModelViaGateway: undefined } }
    })
    if (!updated) throw new Error(t('code_cli.model.agent_missing'))
    return updated
  }
  const shellEnv = await getRawShellEnv()
  if (hasConfigOverrides(native.overrides, config.env, shellEnv)) {
    throw new Error(t('code_cli.model.environment_mismatch'))
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
      return [{ target: native.target, content: updateNativeModelConfig(native.target, current.content, nativeModel) }]
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
          localRuntime: { nativeModel, sourceModelId: undefined, sourceModelViaGateway: undefined }
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
    config.sourceModelViaGateway ||
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
