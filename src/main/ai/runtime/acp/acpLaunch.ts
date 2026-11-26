import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
import { resolveLocalAgentCli } from '@main/services/codeCli'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { bindCliGatewayRoute } from '../agentApiGateway'
import { resolveCliProgram } from '../cli/cliProgram'
import { acpPreset } from './acpPresets'

export function resolveAcpLaunch(
  config: LocalAgentConfiguration,
  signal?: AbortSignal,
  purpose: 'chat' | 'session' | 'models' = 'chat'
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

export async function withAcpLoginFallback<T>(
  config: LocalAgentConfiguration,
  run: (config: LocalAgentConfiguration) => Promise<T>
): Promise<T> {
  const fallback = acpPreset(config.presetId)?.cliFallback
  if (!fallback || config.executableOverride || config.args.length) return run(config)
  try {
    return await run(config)
  } catch (error) {
    if (!fallback.retry(error)) throw error
    // The standalone adapter and terminal CLI own separate sign-ins.
    const terminal = await resolveLocalAgentCli(config).catch(() => undefined)
    if (!terminal) throw error
    return run({ ...config, executableOverride: terminal.executable, args: fallback.args })
  }
}

/** Resolves a config-file default against the IDs advertised by the ACP session. */
export function resolveConfiguredAcpModel(presetId: string | undefined, model: string, available: string[]): string {
  if (available.includes(model)) return model
  const candidate = acpPreset(presetId)?.catalogId?.(model, available)
  return candidate && available.includes(candidate) ? candidate : model
}
