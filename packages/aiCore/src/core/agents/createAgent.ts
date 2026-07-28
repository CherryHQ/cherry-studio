/**
 * Agent factory
 * Reuses createExecutor's provider resolution + plugin pipeline to build a ToolLoopAgent
 */
import type { ToolLoopAgentSettings, ToolSet } from 'ai'
import { ToolLoopAgent } from 'ai'

import type { AiPlugin } from '../plugins'
import type { CoreProviderSettingsMap, StringKeys } from '../providers/types'
import { createExecutor } from '../runtime'

export type CreateAgentOptions<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>,
  TOOLS extends ToolSet = {}
> = {
  providerId: T
  providerSettings: TSettingsMap[T]
  modelId: string
  plugins?: AiPlugin[]
  agentSettings: Omit<ToolLoopAgentSettings<never, TOOLS, never>, 'model'>
}

export async function createAgent<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>,
  TOOLS extends ToolSet = {}
>(options: CreateAgentOptions<TSettingsMap, T, TOOLS>): Promise<ToolLoopAgent<never, TOOLS, never>> {
  const { providerId, providerSettings, modelId, plugins, agentSettings } = options

  // 1. Create executor (extensionRegistry resolves provider + modelResolver)
  const executor = await createExecutor<TSettingsMap, T>(providerId, providerSettings, plugins)

  // 2. Register internal plugins (same as streamText/generateText)
  executor.pluginEngine.usePlugins([executor.createResolveModelPlugin(), executor.createConfigureContextPlugin()])

  // 3. Resolve model + apply middleware via pluginEngine
  const resolvedModel = await executor.pluginEngine.resolveModel(modelId)

  // 4. Build ToolLoopAgent
  return new ToolLoopAgent({
    ...agentSettings,
    model: resolvedModel
  })
}
