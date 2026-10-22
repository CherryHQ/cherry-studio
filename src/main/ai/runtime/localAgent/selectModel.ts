import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentService } from '@data/services/AgentService'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { UniqueModelId } from '@shared/data/types/model'
import { getCliConfigTargets } from '@shared/utils/cliConfig'
import type { CliConfigTarget, CliConfigWriteFile, FileConfiguredCli } from '@shared/utils/cliConfig'

import { readNativeModelConfig, updateNativeModelConfig } from './nativeModelConfig'

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
  const native = config?.presetId && LOCAL_AGENT_MODEL_CONFIG[config.presetId]
  if (!agent || agent.type !== 'local' || !config || !native) {
    throw new Error('This agent does not support saving a native default model')
  }
  const shellEnv = await getRawShellEnv()
  const overrides = [
    'HOME',
    'USERPROFILE',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'PI_CODING_AGENT_DIR',
    'KIMI_CODE_HOME',
    'HERMES_HOME',
    'XDG_CONFIG_HOME',
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR',
    'CODEBUDDY_MODEL',
    'ANTHROPIC_MODEL'
  ]
  if (overrides.some((key) => key in config.env && config.env[key] !== shellEnv[key])) {
    throw new Error(
      'Agent environment overrides differ from your terminal. Remove the overrides before selecting a global model.'
    )
  }
  if (selection.sourceModelId && !selection.files?.length) throw new Error('Missing provider configuration')
  if (config.sourceModelId && !selection.sourceModelId && !selection.files?.length) {
    throw new Error('Provider configuration must be cleared before selecting a native model')
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
        throw new Error('CLI configuration changed. Please select the model again.')
      }
      const current = currentFiles.find((file) => file.target === native.target)!

      const files = selection.files?.map((file) => ({ ...file })) ?? []
      const primary = files.find((file) => file.target === native.target)
      if (selection.sourceModelId) {
        if (!primary || primary.content === undefined) throw new Error('Missing model configuration')
        nativeModel = readNativeModelConfig(native.target, primary.content)
        if (!nativeModel) throw new Error('Provider configuration has no default model')
      } else {
        const content = updateNativeModelConfig(native.target, primary?.content ?? current.content, nativeModel)
        if (primary) primary.content = content
        else files.push({ target: native.target, content })
      }
      return files
    },
    () => {
      // Re-read after queued I/O so an enable or environment edit is not overwritten.
      const current = agentService.getAgent(agentId)?.configuration?.localRuntime
      if (!current) throw new Error('Agent no longer exists')
      const updated = agentService.updateAgent(agentId, {
        configuration: {
          localRuntime: {
            ...current,
            nativeModel,
            sourceModelId: selection.sourceModelId,
            sourceModelViaGateway: selection.sourceModelId ? selection.sourceModelViaGateway : undefined
          }
        }
      })
      if (!updated) throw new Error('Agent no longer exists')
      return updated
    }
  )
  notifyLocalModelChange(updated.id)
  return updated
}

export function syncLocalAgentConfigModel(
  tool: FileConfiguredCli,
  files: CliConfigWriteFile[],
  preserveModelSource = false
): string | undefined {
  const entry = Object.entries(LOCAL_AGENT_MODEL_CONFIG).find(([, config]) => config.tool === tool)
  if (!entry) return
  const [presetId, native] = entry
  const file = files.find((file) => file.target === native.target)
  const agent = agentService
    .listAgents()
    .agents.find((agent) => agent.configuration?.localRuntime?.presetId === presetId)
  if (!agent?.configuration?.localRuntime) return
  const nativeModel =
    file?.content === undefined
      ? agent.configuration.localRuntime.nativeModel
      : readNativeModelConfig(native.target, file.content)
  agentService.updateAgent(agent.id, {
    configuration: {
      localRuntime: {
        ...agent.configuration.localRuntime,
        nativeModel,
        sourceModelViaGateway:
          preserveModelSource && nativeModel === agent.configuration.localRuntime.nativeModel
            ? agent.configuration.localRuntime.sourceModelViaGateway
            : undefined,
        sourceModelId:
          preserveModelSource && nativeModel === agent.configuration.localRuntime.nativeModel
            ? agent.configuration.localRuntime.sourceModelId
            : undefined
      }
    }
  })
  return agent.id
}

export function notifyLocalModelChange(agentId: string) {
  notifyDataApiDataChange([
    { endpoint: '/agents', kind: 'projection', entityIds: [agentId] },
    { endpoint: '/agents/:agentId', entityIds: [agentId] }
  ])
}
