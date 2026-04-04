/**
 * Agent 工厂函数
 * 复用 createExecutor 的 provider 解析 + plugin 管道，构造 ToolLoopAgent
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

  // 1. 创建 executor（extensionRegistry 解析 provider + modelResolver）
  const executor = await createExecutor<TSettingsMap, T>(providerId, providerSettings, plugins)

  // 2. 解析 model + 应用 middleware（plugin 管道）
  const resolvedModel = await executor.resolveModelWithPlugins(modelId)

  // 3. 构造 ToolLoopAgent
  return new ToolLoopAgent({
    ...agentSettings,
    model: resolvedModel
  })
}
