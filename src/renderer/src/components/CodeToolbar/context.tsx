import React, { createContext, use, useCallback, useMemo, useState } from 'react'

import { CodeTool, CodeToolContext } from './types'

// 定义上下文默认值
const defaultContext: CodeToolContext = {
  code: '',
  language: ''
}

export interface CodeToolbarContextType {
  tools: CodeTool[]
  context: CodeToolContext
  registerTool: (tool: CodeTool) => void
  removeTool: (id: string) => void
  updateContext: (newContext: Partial<CodeToolContext>) => void
}

const defaultCodeToolbarContext: CodeToolbarContextType = {
  tools: [],
  context: defaultContext,
  registerTool: () => {},
  removeTool: () => {},
  updateContext: () => {}
}

const CodeToolbarContext = createContext<CodeToolbarContextType>(defaultCodeToolbarContext)

export const CodeToolbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tools, setTools] = useState<CodeTool[]>([])
  const [context, setContext] = useState<CodeToolContext>(defaultContext)

  // 注册工具，如果已存在同ID工具则替换
  const registerTool = useCallback((tool: CodeTool) => {
    setTools((prev) => {
      const filtered = prev.filter((t) => t.id !== tool.id)
      return [...filtered, tool].sort((a, b) => b.order - a.order)
    })
  }, [])

  // 移除工具
  const removeTool = useCallback((id: string) => {
    setTools((prev) => prev.filter((tool) => tool.id !== id))
  }, [])

  // 更新上下文
  const updateContext = useCallback((newContext: Partial<CodeToolContext>) => {
    setContext((prev) => ({ ...prev, ...newContext }))
  }, [])

  const value: CodeToolbarContextType = useMemo(
    () => ({
      tools,
      context,
      registerTool,
      removeTool,
      updateContext
    }),
    [tools, context, registerTool, removeTool, updateContext]
  )

  return <CodeToolbarContext value={value}>{children}</CodeToolbarContext>
}

export const useCodeToolbar = () => {
  const context = use(CodeToolbarContext)
  if (!context) {
    throw new Error('useCodeToolbar must be used within a CodeToolbarProvider')
  }
  return context
}
