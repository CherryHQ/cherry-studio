import React, { createContext, use, useCallback, useState } from 'react'

/**
 * 代码块工具定义接口
 * @param id 唯一标识符
 * @param type 工具类型
 * @param icon 按钮图标
 * @param tooltip 提示文本
 * @param condition 显示条件
 * @param onClick 点击动作
 * @param order 显示顺序，越小越靠右
 */
export interface Tool {
  id: string
  type: 'core' | 'quick'
  icon: React.ReactNode
  tooltip: string
  condition?: (ctx?: ToolContext) => boolean
  onClick: (ctx?: ToolContext) => void
  order?: number
}

/**
 * 工具上下文接口
 * @param code 代码内容
 * @param language 语言类型
 * @param viewType 视图类型
 * @param viewState 视图组件状态
 * @param viewRef 视图组件引用
 */
export interface ToolContext {
  code: string
  language: string
  viewType: string
  viewState: any
  viewRef: React.RefObject<any>
}

// 定义上下文默认值
const defaultContext: ToolContext = {
  code: '',
  language: '',
  viewType: '',
  viewState: {},
  viewRef: { current: null }
}

interface ToolbarContextType {
  tools: Tool[]
  context: ToolContext
  registerTool: (tool: Tool) => void
  removeTool: (id: string) => void
  updateContext: (newContext: Partial<ToolContext>) => void
}

const defaultToolbarContext: ToolbarContextType = {
  tools: [],
  context: defaultContext,
  registerTool: () => {},
  removeTool: () => {},
  updateContext: () => {}
}

export const ToolbarContext = createContext<ToolbarContextType>(defaultToolbarContext)

export const useToolbar = () => use(ToolbarContext)

export const ToolbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tools, setTools] = useState<Tool[]>([])
  const [context, setContext] = useState<ToolContext>(defaultContext)

  // 注册工具，如果已存在同ID工具则替换
  const registerTool = useCallback((tool: Tool) => {
    setTools((prev) => {
      const filtered = prev.filter((t) => t.id !== tool.id)
      return [...filtered, tool].sort((a, b) => (b.order || 0) - (a.order || 0))
    })
  }, [])

  // 移除工具
  const removeTool = useCallback((id: string) => {
    setTools((prev) => prev.filter((tool) => tool.id !== id))
  }, [])

  // 更新上下文
  const updateContext = useCallback((newContext: Partial<ToolContext>) => {
    setContext((prev) => ({ ...prev, ...newContext }))
  }, [])

  const value: ToolbarContextType = {
    tools,
    context,
    registerTool,
    removeTool,
    updateContext
  }

  return <ToolbarContext value={value}>{children}</ToolbarContext>
}
