import { parse as parseDotenv } from 'dotenv'
import { parse, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { parse as parseYaml } from 'yaml'

import type { AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'
import { cliConfigRecord } from '@cherrystudio/agent-runtime/cli'
import { modelService } from '@data/services/ModelService'
import { getEnvironmentValue } from '@main/utils/env'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { readModelProfile, type CliModelBinding } from './cliModelProfile'
import type { LaunchConfigFiles } from './cliProgram'

type GatewayCredential = { baseUrl: string; apiKey: string }

export type CliGatewayRoute = {
  path: string
  model: string
  contextWindow?: number
  baseUrl: string
  apiKey: string
  install(credential: GatewayCredential): void
}

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
    return cliConfigRecord(toml.parse(content))
  } catch {
    return undefined
  }
}

function parseYamlObject(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    return cliConfigRecord(parseYaml(content))
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

export function resolveCliGatewayRoute(
  selection: { nativeModel: string; sourceModelId: NonNullable<LocalAgentConfiguration['sourceModelId']> },
  binding: CliModelBinding,
  files: LaunchConfigFiles,
  env: Record<string, string>,
  shellEnv: NodeJS.ProcessEnv
): CliGatewayRoute | undefined {
  const { nativeModel, sourceModelId } = selection
  const { gatewayOverlay: overlay, gateway, profile } = binding
  if (
    profile?.format === 'json' &&
    profile.matchesEnvironment &&
    !profile.matchesEnvironment(
      (key) => getEnvironmentValue(env, key),
      (key) => getEnvironmentValue(shellEnv, key)
    )
  )
    return undefined

  let route: ReturnType<typeof readGatewayRoute>
  let install: CliGatewayRoute['install']
  if (overlay) {
    const saved = parseJsonObject(files[overlay.target])
    const overrides = parseJsonObject(env[overlay.envKey] ?? '{}')
    if (!saved || !overrides) return undefined
    const overlayRoute = overlay.read(saved, overrides, nativeModel)
    if (!overlayRoute) return undefined
    route = overlayRoute
    install = (credential) => {
      env[overlay.envKey] = overlayRoute.bind(credential)
    }
  } else {
    const bindCredential = gateway?.bindCredential
    if (!gateway || !bindCredential || !profile) return undefined
    const primary = files[profile.target]
    if (!primary) return undefined
    try {
      if (readModelProfile(profile, primary) !== nativeModel) return undefined
    } catch {
      return undefined
    }
    route = readGatewayRoute(gateway, profile.target, nativeModel, files, env)
    install = (credential) => bindCredential(env, credential)
  }

  if (!route?.path || typeof route.baseUrl !== 'string' || typeof route.apiKey !== 'string') return undefined
  const source = parseUniqueModelId(sourceModelId)
  const model = modelService.getByKey(source.providerId, source.modelId)
  const wireModel = formatGatewayModelId(source.providerId, model.apiModelId ?? source.modelId)
  if (route.model !== wireModel) return undefined
  return {
    path: route.path,
    model: wireModel,
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    ...(model.contextWindow && { contextWindow: model.contextWindow }),
    install
  }
}
