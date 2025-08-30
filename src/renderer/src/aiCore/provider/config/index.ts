// /**
//  * Provider解析规则模块导出
//  */

// // 导出类型
// export type { ModelRule } from './types'

// // 导出匹配函数和解析器
// export { endpointIs, resolveProvider, startsWith } from './helper'

// // 导出规则集
// export { AIHUBMIX_RULES } from './aihubmix'
// export { NEWAPI_RULES } from './newApi'

export { aihubmixProviderCreator } from './aihubmix'
export { newApiResolverCreator } from './newApi'
