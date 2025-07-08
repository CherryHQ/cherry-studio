import Logger from '@renderer/config/logger'

// 存储每个工具的确认Promise的resolve函数
const toolConfirmResolvers = new Map<string, (value: boolean) => void>()
// 存储每个工具的abort监听器清理函数
const abortListeners = new Map<string, () => void>()

export function requestUserConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    const globalKey = '_global'
    toolConfirmResolvers.set(globalKey, resolve)
  })
}

export function requestToolConfirmation(toolId: string, abortSignal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve(false)
      return
    }

    toolConfirmResolvers.set(toolId, resolve)

    if (abortSignal) {
      const abortListener = () => {
        const resolver = toolConfirmResolvers.get(toolId)
        if (resolver) {
          resolver(false)
          toolConfirmResolvers.delete(toolId)
          abortListeners.delete(toolId)
        }
      }

      abortSignal.addEventListener('abort', abortListener)

      // 存储清理函数
      const cleanup = () => {
        abortSignal.removeEventListener('abort', abortListener)
        abortListeners.delete(toolId)
      }
      abortListeners.set(toolId, cleanup)
    }
  })
}

export function confirmToolAction(toolId: string) {
  const resolve = toolConfirmResolvers.get(toolId)
  if (resolve) {
    resolve(true)
    toolConfirmResolvers.delete(toolId)

    // 清理abort监听器
    const cleanup = abortListeners.get(toolId)
    if (cleanup) {
      cleanup()
    }
  } else {
    Logger.warn(`🔧 [userConfirmation] No resolver found for tool: ${toolId}`)
  }
}

export function cancelToolAction(toolId: string) {
  const resolve = toolConfirmResolvers.get(toolId)
  if (resolve) {
    resolve(false)
    toolConfirmResolvers.delete(toolId)

    // 清理abort监听器
    const cleanup = abortListeners.get(toolId)
    if (cleanup) {
      cleanup()
    }
  } else {
    Logger.warn(`🔧 [userConfirmation] No resolver found for tool: ${toolId}`)
  }
}

// 获取所有待确认的工具ID
export function getPendingToolIds(): string[] {
  return Array.from(toolConfirmResolvers.keys()).filter((id) => id !== '_global')
}

// 检查某个工具是否在等待确认
export function isToolPending(toolId: string): boolean {
  return toolConfirmResolvers.has(toolId)
}
