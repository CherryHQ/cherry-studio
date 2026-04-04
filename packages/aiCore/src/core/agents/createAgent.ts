/**
 * Agent 工厂函数
 * 复用 createExecutor 的 provider 解析 + plugin 管道，构造 ToolLoopAgent
 */
import type { ToolLoopAgentSettings, ToolSet } from 'ai'
import { ToolLoopAgent } from 'ai'

import type { AiPlugin } from '../plugins'
import { definePlugin } from '../plugins'
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

  // 2. 挂载 resolveModel 插件（将 executor 的模型解析能力注入 pluginEngine）
  executor.pluginEngine.use(
    definePlugin({
      name: '_agent_resolveModel',
      enforce: 'post',

      resolveModel: async (id: string) => executor.resolveModel(id)
    })
  )

  // 3. 通过 pluginEngine 解析 model + 应用 middleware
  const resolvedModel = await executor.pluginEngine.resolveModel(modelId)

  // 4. 构造 ToolLoopAgent
  return new ToolLoopAgent({
    ...agentSettings,
    model: resolvedModel
  })
}
