import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { acpPreset } from './acpPresets'
import { bindLocalGatewayUsage } from './gatewayUsage'
import { resolveLocalAgentCli, resolveLocalAgentLaunch } from './launch'

export async function prepareAcpChatLaunch(config: LocalAgentConfiguration, sessionId: string, signal: AbortSignal) {
  const { configFiles, ...launch } = await resolveLocalAgentLaunch(config, signal, 'session')
  const prepared = await acpPreset(config.presetId)?.prepareChat?.(config, launch, sessionId)
  const gateway = prepared?.gateway ?? (await bindLocalGatewayUsage(config, sessionId, launch.env, configFiles))
  return { launch, gateway, mode: prepared?.mode }
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
