import { isFunctionCallingModel } from '@renderer/config/models'
import type { Model } from '@shared/data/types/model'

/**
 * 是否启用工具使用 (function call)。v2 assistant 不再内嵌 model；调用方
 * 从 ToolContext 拿 v2 Model 一起传入。
 */
export function isSupportedToolUse(model: Model | undefined) {
  if (!model) return false
  return isFunctionCallingModel(model)
}
