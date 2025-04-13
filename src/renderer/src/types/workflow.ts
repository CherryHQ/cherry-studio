import { MinAppType } from '@types'

export type FlowType = 'workflow' | 'chatflow'

/**
 * 定义 Workflow 类型的工作流配置
 */
interface FlowConfigBase {
  id: string // 工作流唯一标识
  providerId: string // 所属 Provider 的 ID
  name: string // 工作流名称
  description?: string // 工作流描述
  enabled: boolean // 是否启用
}

interface WorkflowSpecificConfig extends FlowConfigBase {
  type: 'workflow'
  url: string // 外部 URL，通过 MinAppType 打开
  minAppConfig?: Omit<MinAppType, 'id' | 'name' | 'url'> // 可选的 MinApp 配置 (logo, bodered, background, style)
}

/**
 * 定义 Chatflow 类型的工作流配置
 */
interface ChatflowSpecificConfig extends FlowConfigBase {
  type: 'chatflow'
  apiKey: string // 此工作流专属的 API Key
  apiHost: string // 此工作流专属的 API Host
}

/**
 * 定义单个工作流配置 (联合类型)
 */
export type FlowConfig = WorkflowSpecificConfig | ChatflowSpecificConfig

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
  workflows: FlowConfig[] // 该 Provider 下的所有工作流 (使用联合类型)
  enabled: boolean // 是否启用该 Provider
  isSystem?: boolean // 是否为系统内置 Provider
}
