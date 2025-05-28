import { useCallback } from 'react'

import { CodeTool } from './types'

export const useCodeTool = (setTools?: (value: React.SetStateAction<CodeTool[]>) => void) => {
  // 注册工具，如果已存在同ID工具则替换
  const registerTool = useCallback(
    (tool: CodeTool) => {
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
