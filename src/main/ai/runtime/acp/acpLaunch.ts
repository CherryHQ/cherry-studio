import { application } from '@application'
import { acpGatewayPath } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { getAcpLaunchBypassArgs, getLocalAgentPreset, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { isAgentOnlyProvider } from '@shared/utils/provider'

import { bindCliGatewayRoute } from '../agentApiGateway'
import { resolveCliProgram } from '../cli/cliProgram'
import { acpPreset } from './acpPresets'

const logger = loggerService.withContext('acpLaunch')

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

export async function prepareAcpChatLaunch(
  config: LocalAgentConfiguration,
  sessionId: string,
  signal: AbortSignal,
  bypass = false
) {
  const preset = acpPreset(config.presetId)
  const bypassArgs = bypass && getAcpLaunchBypassArgs(config)
  const { gatewayRoute, ...launch } = await resolveAcpLaunch(
    bypassArgs ? { ...config, args: [...bypassArgs] } : config,
    signal,
    'session'
  )
  const endpoint = getLocalAgentPreset(config.presetId)?.gatewayModelEndpoint
  if (config.sourceModelViaGateway && config.sourceModelId && endpoint) {
    if (!preset?.applyGatewayModel || config.executableOverride) throw new Error(t('code_cli.model.unsupported'))
    const { providerId, modelId } = parseUniqueModelId(config.sourceModelId)
    const model = modelService.getByKey(providerId, modelId)
    const provider = providerService.getByProviderId(providerId)
    if (!model.isEnabled || !provider.isEnabled || isAgentOnlyProvider(provider) || !isGatewayRoutableModel(model)) {
      throw new Error(t('code_cli.model.model_config_missing'))
    }
    const address = formatGatewayModelId(providerId, model.apiModelId ?? modelId)
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
