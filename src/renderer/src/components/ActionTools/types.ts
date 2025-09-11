/**
 * 动作工具基本信息
 */
export interface ActionToolSpec {
  id: string
  type: 'core' | 'quick'
  order: number
}

/**
 * 动作工具定义接口
 * @param id 唯一标识符
 * @param type 工具类型
 * @param order 显示顺序，越小越靠右
 * @param icon 按钮图标
 * @param tooltip 提示文本
 * @param visible 显示条件
 * @param onClick 点击动作
 * @param children 子工具（例如 more 下拉菜单）
 */
export interface ActionTool extends ActionToolSpec {
  icon: React.ReactNode
  tooltip?: string
  visible?: () => boolean
  onClick?: () => void
  children?: Omit<ActionTool, 'children'>[]
}

/**
 * 子组件向父组件注册工具所需的 props
 */
export interface ToolRegisterProps {
  setTools?: (value: React.SetStateAction<ActionTool[]>) => void
}
