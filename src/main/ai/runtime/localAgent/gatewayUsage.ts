import { parse as parseDotenv } from 'dotenv'
import { parse, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { parse as parseYaml } from 'yaml'

import { application } from '@application'
import { acpConfigRecord, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'
import { modelService } from '@data/services/ModelService'
import { getEnvironmentValue, mergeEnvironment } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { acpPreset } from './acpPresets'
import type { LaunchConfigFiles } from './launch'
import { readNativeModelConfig } from './nativeModelConfig'

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  const errors: ParseError[] = []
  const parsed = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

function parseTomlObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    return acpConfigRecord(toml.parse(content))
  } catch {
    return undefined
  }
}

function parseYamlObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    return acpConfigRecord(parseYaml(content))
  } catch {
    return undefined
  }
}

const parseConfig = { json: parseJsonObject, yaml: parseYamlObject, toml: parseTomlObject }

function readGatewayRoute(
  gateway: AcpGatewayConfig<CliConfigTarget>,
  primary: CliConfigTarget,
  nativeModel: string,
  files: LaunchConfigFiles,
  env: NodeJS.ProcessEnv
) {
  const document = parseConfig[gateway.format](files[gateway.target ?? primary])
  if (!document) return undefined
  const variables = gateway.envFile ? parseDotenv(files[gateway.envFile] ?? '') : undefined
  const related = gateway.related && parseConfig[gateway.related.format](files[gateway.related.target])
  return gateway.read(
    document,
    nativeModel,
    (key) => (variables ? variables[key] : getEnvironmentValue(env, key)),
    related
  )
}

/** Bind only the saved Cherry gateway route; unrelated native configuration stays CLI-owned. */
export async function bindLocalGatewayUsage(
  config: LocalAgentConfiguration,
  sessionId: string,
  env: NodeJS.ProcessEnv,
  files: LaunchConfigFiles
): Promise<{ dispose: () => void } | undefined> {
  if (!config.sourceModelViaGateway || !config.sourceModelId || !config.nativeModel || !config.presetId) return
  const native = LOCAL_AGENT_MODEL_CONFIG[config.presetId]
  if (!native) return
  const source = parseUniqueModelId(config.sourceModelId)
  // The wire name can differ from Cherry's internal model id.
  const model = modelService.getByKey(source.providerId, source.modelId)
  const wireModel = formatGatewayModelId(source.providerId, model.apiModelId ?? source.modelId)

  const preset = acpPreset(config.presetId)
  const overlay = preset?.gatewayOverlay
  const gatewayConfig = preset?.gateway
  if (!overlay && !gatewayConfig) return
  const profile = preset?.profile
  if (profile?.format === 'json' && profile.matchesEnvironment) {
    const shell = await getRawShellEnv()
    const effective = mergeEnvironment(shell, env)
    if (
      !profile.matchesEnvironment(
        (key) => getEnvironmentValue(effective, key),
        (key) => getEnvironmentValue(shell, key)
      )
    )
      return
  }

  let overlayRoute: ReturnType<NonNullable<typeof overlay>['read']>
  if (overlay) {
    const saved = parseJsonObject(files[overlay.target])
    const overrides = parseJsonObject(env[overlay.envKey] ?? '{}')
    if (!saved || !overrides) return
    overlayRoute = overlay.read(saved, overrides, config.nativeModel)
  }
  if (gatewayConfig) {
    const primary = files[native.target]
    if (!primary) return
    try {
      if (readNativeModelConfig(native.target, primary) !== config.nativeModel) return
    } catch {
      return
    }
  }
  const binding = gatewayConfig
    ? readGatewayRoute(gatewayConfig, native.target, config.nativeModel, files, env)
    : overlayRoute
  if (!binding?.path || binding.model !== wireModel || typeof binding.baseUrl !== 'string') return

  const gateway = application.get('ApiGatewayService')
  const current = gateway.getCurrentConfig()
  const baseUrl = URL.parse(binding.baseUrl)
  if (
    !baseUrl ||
    baseUrl.origin !== gatewayClientOrigin(current.host, current.port) ||
    !current.apiKey ||
    binding.apiKey !== current.apiKey
  ) {
    return
  }

  const bindCredential = gatewayConfig?.bindCredential
  const lease = await gateway.createScopedCredential({
    path: binding.path,
    model: wireModel,
    agentSessionId: sessionId,
    ...(!bindCredential && !overlayRoute && { allowPublicCorrelation: true })
  })
  try {
    if (overlay && overlayRoute) env[overlay.envKey] = overlayRoute.bind(lease)
    else bindCredential?.(env, lease)
    return lease
  } catch (error) {
    lease.dispose()
    throw error
  }
}
