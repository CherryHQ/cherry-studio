/**
 * 定义单个工作流
 */
export interface Workflow {
  id: string // 工作流唯一标识
  providerId: string // 所属 Provider 的 ID
  name: string // 工作流名称
  description?: string // 工作流描述
  apiKey: string // 此工作流专属的 API Key
  apiHost?: string // 此工作流专属的 API Host (可选, 可能继承自 Provider)
  enabled: boolean // 是否启用
}

/**
 * 定义工作流提供者
 */
export interface WorkflowProvider {
  id: string // Provider 唯一标识
  name: string // Provider 名称
  workflows: Workflow[] // 该 Provider 下的所有工作流
  enabled: boolean // 是否启用该 Provider
}
