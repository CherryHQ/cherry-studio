import { HealthStatus } from '@renderer/types/healthCheck'

/**
 * 用于展示单个健康检查结果的必要数据
 */
export interface HealthResult {
  status: HealthStatus
  latency?: number
  error?: string
  // 用于在 Tooltip 中显示额外上下文信息，例如 API Key 或模型名称
  label?: string
}
