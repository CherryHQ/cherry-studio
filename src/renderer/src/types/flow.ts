import { IUserInputForm } from '@dify-chat/api'

export type FlowType = 'workflow' | 'chatflow'

/**
 * 定义 Workflow 类型的工作流配置
 */
interface FlowBase {
  id: string // 工作流唯一标识
  providerId: string // 所属 Provider 的 ID
  name: string // 工作流名称
  description?: string // 工作流描述
  enabled: boolean // 是否启用
  apiKey: string
  apiHost: string
  parameters?: IUserInputForm[]
}

export interface Workflow extends FlowBase {
  type: 'workflow'
}

/**
 * 定义 Chatflow 类型的工作流配置
 */
export interface Chatflow extends FlowBase {
  type: 'chatflow'
}

/**
 * 定义单个工作流配置 (联合类型)
 */
export type Flow = Workflow | Chatflow

// /**
//  * 定义单个工作流
//  */
// export interface FlowConfig {
//   id: string // 工作流唯一标识
//   providerId: string // 所属 Provider 的 ID
//   name: string // 工作流名称
//   description?: string // 工作流描述
//   apiKey: string // 此工作流专属的 API Key
//   apiHost: string // 此工作流专属的 API Host (可选, 可能继承自 Provider)
//   enabled: boolean // 是否启用
// }

/**
 * 定义工作流提供者
 */
export interface FlowEngine {
  id: string // Provider 唯一标识
  name: string // Provider 名称
  flows: Flow[] // 该 Provider 下的所有工作流 (使用联合类型)
  enabled: boolean // 是否启用该 Provider
  isSystem?: boolean // 是否为系统内置 Provider
}
