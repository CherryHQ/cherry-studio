import { useCallback } from 'react'

import { ActionTool, ToolRegisterProps } from '../types'

export const useToolManager = (setTools?: ToolRegisterProps['setTools']) => {
  // 注册工具，如果已存在同ID工具则替换
  const registerTool = useCallback(
    (tool: ActionTool) => {
      setTools?.((prev) => {
        const filtered = prev.filter((t) => t.id !== tool.id)
        return [...filtered, tool].sort((a, b) => b.order - a.order)
      })
    },
    [setTools]
  )

  // 移除工具
  const removeTool = useCallback(
    (id: string) => {
      setTools?.((prev) => prev.filter((tool) => tool.id !== id))
    },
    [setTools]
  )

  return { registerTool, removeTool }
}
