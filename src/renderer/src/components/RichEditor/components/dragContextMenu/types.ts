import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { ReactNode } from 'react'

/**
 * 操作组类型 - 用于菜单项分组
 */
export enum ActionGroup {
  TRANSFORM = 'transform', // 节点转换操作
  FORMAT = 'format', // 格式化操作
  BLOCK = 'block', // 块级操作
  INSERT = 'insert', // 插入操作
  AI = 'ai' // AI 相关操作 (预留)
}

/**
 * 菜单操作项接口
 */
export interface MenuAction {
  /** 操作唯一标识 */
  id: string
  /** 显示标签 */
  label: string
  /** 图标 */
  icon?: ReactNode
  /** 操作组 */
  group: ActionGroup
  /** 快捷键描述 */
  shortcut?: string
  /** 是否为危险操作 */
  danger?: boolean
  /** 是否可用 */
  isEnabled: (editor: Editor, node: Node, pos: number) => boolean
  /** 执行操作 */
  execute: (editor: Editor, node: Node, pos: number) => void
  /** 自定义类名 */
  className?: string
}

/**
 * 节点转换选项
 */
export interface NodeTransformOptions {
  /** 目标节点类型 */
  nodeType: string
  /** 节点属性 */
  attrs?: Record<string, any>
  /** 是否保留内容 */
  preserveContent?: boolean
}

/**
 * 拖拽上下文菜单属性
 */
export interface DragContextMenuProps {
  /** 编辑器实例 */
  editor: Editor
  /** 当前节点 */
  node: Node
  /** 节点在文档中的位置 */
  position: number
  /** 菜单显示状态 */
  visible: boolean
  /** 菜单位置 */
  menuPosition: { x: number; y: number }
  /** 关闭回调 */
  onClose: () => void
  /** 自定义操作 */
  customActions?: MenuAction[]
  /** 禁用的操作 ID 列表 */
  disabledActions?: string[]
}

/**
 * 拖拽手柄属性
 */
export interface DragHandleProps {
  /** 编辑器实例 */
  editor: Editor
  /** 当前节点 */
  node: Node
  /** 节点位置 */
  position: number
  /** 是否显示 */
  visible: boolean
  /** 点击回调 */
  onClick: () => void
  /** 拖拽开始回调 */
  onDragStart?: (e: DragEvent) => void
  /** 自定义类名 */
  className?: string
}

/**
 * 菜单可见性配置
 */
export interface MenuVisibilityOptions {
  /** 当前编辑器实例 */
  editor: Editor
  /** 当前节点 */
  node: Node
  /** 节点位置 */
  position: number
  /** 自定义可见性规则 */
  customRules?: Array<(editor: Editor, node: Node, pos: number) => boolean>
}

/**
 * 菜单操作结果
 */
export interface MenuActionResult {
  /** 是否成功执行 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 是否需要关闭菜单 */
  shouldCloseMenu?: boolean
}

/**
 * 颜色选择器选项
 */
export interface ColorOption {
  /** 颜色值 */
  color: string
  /** 显示名称 */
  name: string
  /** 是否为默认颜色 */
  isDefault?: boolean
}

/**
 * 节点转换映射
 */
export interface NodeTransformMap {
  [key: string]: {
    /** 显示名称 */
    label: string
    /** 图标 */
    icon: ReactNode
    /** 转换配置 */
    transform: NodeTransformOptions
    /** 是否可用的检查函数 */
    isAvailable?: (editor: Editor, currentNode: Node) => boolean
  }
}

/**
 * 拖拽上下文菜单配置
 */
export interface DragContextMenuConfig {
  /** 是否启用 */
  enabled: boolean
  /** 默认操作列表 */
  defaultActions: string[]
  /** 自定义操作 */
  customActions?: MenuAction[]
  /** 操作组排序 */
  groupOrder?: ActionGroup[]
  /** 颜色选择器配置 */
  colorOptions?: ColorOption[]
  /** 节点转换映射 */
  transformMap?: NodeTransformMap
  /** 菜单样式配置 */
  menuStyles?: {
    maxWidth?: number
    maxHeight?: number
    showShortcuts?: boolean
  }
}

/**
 * 钩子返回值 - useDragContextMenu
 */
export interface UseDragContextMenuReturn {
  /** 菜单是否可见 */
  isMenuVisible: boolean
  /** 菜单位置 */
  menuPosition: { x: number; y: number }
  /** 当前节点信息 */
  currentNode: { node: Node; position: number } | null
  /** 显示菜单 */
  showMenu: (node: Node, position: number, clientPos: { x: number; y: number }) => void
  /** 隐藏菜单 */
  hideMenu: () => void
  /** 执行操作 */
  executeAction: (action: MenuAction) => Promise<MenuActionResult>
}

/**
 * 钩子返回值 - useMenuActionVisibility
 */
export interface UseMenuActionVisibilityReturn {
  /** 可见的操作列表 */
  visibleActions: MenuAction[]
  /** 按组分类的操作 */
  actionsByGroup: Record<ActionGroup, MenuAction[]>
  /** 刷新可见性 */
  refreshVisibility: () => void
}

/**
 * 事件处理器类型
 */
export interface EventHandlers {
  onMenuShow?: (node: Node, position: number) => void
  onMenuHide?: () => void
  onActionExecute?: (action: MenuAction, result: MenuActionResult) => void
  onError?: (error: Error, context: string) => void
}

/**
 * 位置计算选项
 */
export interface PositionOptions {
  /** 偏移量 */
  offset?: { x: number; y: number }
  /** 边界约束 */
  boundary?: HTMLElement
  /** 对齐方式 */
  align?: 'start' | 'center' | 'end'
  /** 自动调整位置 */
  autoAdjust?: boolean
}
