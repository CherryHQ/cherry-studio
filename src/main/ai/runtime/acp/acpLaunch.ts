import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { bindCliGatewayRoute } from '../agentApiGateway'
import { resolveCliProgram } from '../cli/cliProgram'
import { acpPreset } from './acpPresets'

export function resolveAcpLaunch(
  config: LocalAgentConfiguration,
  signal?: AbortSignal,
  purpose: 'chat' | 'session' | 'models' | 'account' | 'terminal-account' = 'chat'
) {
  return resolveCliProgram(config, purpose, signal, acpPreset(config.presetId))
}

export function resolveAcpModelLaunch(config: LocalAgentConfiguration, signal?: AbortSignal) {
  return resolveAcpLaunch(config, signal, 'models')
}

export async function prepareAcpChatLaunch(config: LocalAgentConfiguration, sessionId: string, signal: AbortSignal) {
  const preset = acpPreset(config.presetId)
  const { gatewayRoute, ...launch } = await resolveAcpLaunch(config, signal, 'session')
  const prepared = await preset?.prepareChat?.(config, launch, sessionId)
  const scopedGateway = prepared?.gateway ? undefined : await bindCliGatewayRoute(sessionId, gatewayRoute)
  return {
    launch,
    gateway: prepared?.gateway ?? scopedGateway,
    contextWindow: scopedGateway ? gatewayRoute?.contextWindow : undefined,
    mode: prepared?.mode
  }
}

export function acpModelSelection(config: LocalAgentConfiguration, launch: AcpLaunch): AcpModelSelection {
  return (
    acpPreset(config.presetId)?.selectModel?.(config.nativeModel, launch) ?? {
      model: config.nativeModel ?? launch.nativeModel
    }
  )
}

/** Resolves a config-file default against the IDs advertised by the ACP session. */
export function resolveConfiguredAcpModel(presetId: string | undefined, model: string, available: string[]): string {
  if (available.includes(model)) return model
  const candidate = acpPreset(presetId)?.catalogId?.(model, available)
  return candidate && available.includes(candidate) ? candidate : model
}
