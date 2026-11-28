import { application } from '@application'
import { acpGatewayPath } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
import type { AgentPermissionMode } from '@cherrystudio/agent-runtime/cli'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { getAcpLaunchBypassArgs, getLocalAgentPreset, type LocalAgentConfiguration } from '@shared/ai/localAgent'

import { resolveCliProgram } from '../cli/cliProgram'
import { resolveGatewayModel } from '../cli/launchBinding'
import { acpPreset } from './acpPresets'

const logger = loggerService.withContext('acpLaunch')

export function resolveAcpLaunch(
  config: LocalAgentConfiguration,
  signal?: AbortSignal,
  purpose: 'chat' | 'session' | 'models' | 'account' | 'terminal-account' = 'chat',
  options?: { sessionId?: string; bindModel?: boolean }
) {
  return resolveCliProgram(config, purpose, signal, acpPreset(config.presetId), options)
}

export function resolveAcpModelLaunch(config: LocalAgentConfiguration, signal?: AbortSignal) {
  return resolveAcpLaunch(config, signal, 'models')
}

export async function prepareAcpChatLaunch(
  config: LocalAgentConfiguration,
  sessionId: string,
  signal: AbortSignal,
  bypass = false,
  permissionMode?: AgentPermissionMode
) {
  const preset = acpPreset(config.presetId)
  const bypassArgs = bypass && getAcpLaunchBypassArgs(config)
  const endpoint = getLocalAgentPreset(config.presetId)?.gatewayModelEndpoint
  const agentEndpoint = config.sourceModelViaGateway && config.sourceModelId && endpoint
  const { modelBinding, ...launch } = await resolveAcpLaunch(
    bypassArgs ? { ...config, args: [...bypassArgs] } : config,
    signal,
    'session',
    { sessionId, bindModel: !agentEndpoint }
  )
  if (agentEndpoint && config.sourceModelId) {
    if (!preset?.applyGatewayModel || config.executableOverride) throw new Error(t('code_cli.model.unsupported'))
    const { model, address } = resolveGatewayModel(config.sourceModelId)
    const lease = await application.get('ApiGatewayService').createScopedCredential({
      paths: [acpGatewayPath(endpoint)],
      model: address,
      agentSessionId: sessionId
    })
    try {
      signal.throwIfAborted()
      const configured = await preset.applyGatewayModel(launch, {
        baseUrl: lease.baseUrl,
        apiKey: lease.apiKey,
        model: address
      })
      return {
        launch,
        gateway: {
          async dispose() {
            lease.dispose()
            await configured
              ?.dispose()
              .catch((error: unknown) => logger.warn('Failed to remove ACP gateway configuration', { error }))
          }
        },
        contextWindow: model.contextWindow
      }
    } catch (error) {
      lease.dispose()
      throw error
    }
  }
  const prepared = await Promise.resolve(preset?.prepareChat?.(config, launch, sessionId, permissionMode)).catch(
    async (error) => {
      await modelBinding?.dispose()
      throw error
    }
  )
  const leases = [prepared?.gateway, modelBinding].filter((lease) => lease !== undefined)
  return {
    launch,
    gateway: leases.length
      ? { dispose: async () => void (await Promise.all(leases.map((lease) => lease.dispose()))) }
      : undefined,
    contextWindow: modelBinding?.contextWindow,
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
