// /**
//  * 配置管理器
//  * 整合options、plugins、middlewares等配置
//  */
// import { LanguageModelV2Middleware } from '@ai-sdk/provider'

// import { ProviderId, ProviderSettingsMap } from '../../types'
// import { createMiddlewares } from '../middleware/manager'
// import { AiPlugin } from '../plugins'
// import { ResolvedConfig } from './types'

// /**
//  * 解析配置
//  * 整合provider配置、插件、中间件、provider选项等
//  */
// export function resolveConfig(
//   providerId: ProviderId,
//   modelId: string,
//   providerSettings: ProviderSettingsMap[ProviderId],
//   plugins: AiPlugin[] = [],
//   middlewares: LanguageModelV2Middleware[] = []
// ): ResolvedConfig {
//   // 使用独立的中间件管理器处理中间件
//   const resolvedMiddlewares = createMiddlewares(middlewares)

//   return {
//     provider: {
//       id: providerId,
//       options: providerSettings
//     },
//     model: {
//       id: modelId
//     },
//     plugins,
//     middlewares: resolvedMiddlewares
//   }
// }
