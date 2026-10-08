/**
 * Agent factory
 * Reuses createExecutor's provider resolution + plugin pipeline to build a ToolLoopAgent
 */
import type { LanguageModelV4 } from '@ai-sdk/provider'
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
  /** Wraps the resolved model (middlewares already applied) before it is handed to the agent */
  wrapModel?: (model: LanguageModelV4) => LanguageModelV4 | Promise<LanguageModelV4>
  agentSettings: Omit<ToolLoopAgentSettings<never, TOOLS>, 'model'>
}

export async function createAgent<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>,
  TOOLS extends ToolSet = {}
>(options: CreateAgentOptions<TSettingsMap, T, TOOLS>): Promise<ToolLoopAgent<never, TOOLS>> {
  const { providerId, providerSettings, modelId, plugins, wrapModel, agentSettings } = options

  // 1. Create executor (extensionRegistry resolves provider + modelResolver)
  const executor = await createExecutor<TSettingsMap, T>(providerId, providerSettings, plugins)

  // 2. Resolve model + apply middleware via the executor's plugin chain
  const resolvedModel = await executor.resolveLanguageModel(modelId)

  // 3. Run the transformParams chain over the agent settings. ToolLoopAgent
  //    holds them for the whole loop and never enters the per-request plugin
  //    pipeline, so this is the only point where a `transformParams`-only
  //    plugin (provider-native tool injection) can contribute.
  const transformedSettings = await executor.pluginEngine.transformAgentSettings(resolvedModel, agentSettings)

  // 4. Apply an optional outermost wrapper (e.g. retry/fallback) around the
  //    fully resolved model after model-specific middleware and settings transforms.
  const finalModel = wrapModel ? await wrapModel(resolvedModel) : resolvedModel

  // 5. Build ToolLoopAgent
  return new ToolLoopAgent<never, TOOLS>({
    ...transformedSettings,
    model: finalModel
  } as ToolLoopAgentSettings<never, TOOLS>)
}
