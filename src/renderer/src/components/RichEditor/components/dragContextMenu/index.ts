/**
 * Drag Context Menu - 拖拽上下文菜单
 *
 * 提供类似 Notion 的块级操作体验，包括：
 * - 拖拽手柄
 * - 上下文菜单
 * - 节点转换操作
 * - 格式化和块操作
 */

// 主要组件
export { default as DragContextMenu } from './DragContextMenu'
// DragContextMenuWrapper 已被 TipTap 扩展替代

// Hooks
export { useDragContextMenu } from './hooks/useDragContextMenu'
export { useMenuActionVisibility } from './hooks/useMenuActionVisibility'

// 操作定义
export * from './actions'
export { allActions, defaultEnabledActions, getActionById } from './actions'

// 类型定义
export type * from './types'

// 样式组件
export * from './styles'

/**
 * 默认配置
 */
export const defaultDragContextMenuConfig = {
  enabled: true,
  defaultActions: [
    'transform-heading-1',
    'transform-heading-2',
    'transform-heading-3',
    'transform-paragraph',
    'transform-bullet-list',
    'transform-ordered-list',
    'transform-blockquote',
    'transform-code-block',
    'block-duplicate',
    'block-copy',
    'block-delete',
    'insert-paragraph-after'
  ],
  groupOrder: ['transform', 'format', 'insert', 'block', 'ai'],
  menuStyles: {
    maxWidth: 320,
    maxHeight: 400,
    showShortcuts: true
  }
}
