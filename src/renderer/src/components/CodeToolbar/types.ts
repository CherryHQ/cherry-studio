/**
 * 代码块工具基本信息
 */
export interface CodeToolSpec {
  id: string
  type: 'core' | 'quick'
  order: number
}

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
export interface CodeTool extends CodeToolSpec {
  icon: React.ReactNode
  tooltip: string
  visible?: () => boolean
  onClick: () => void
}
