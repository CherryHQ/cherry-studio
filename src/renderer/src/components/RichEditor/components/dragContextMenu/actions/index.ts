/**
 * 菜单操作集合
 *
 * 导出所有可用的菜单操作，按类型分组
 */

// 操作定义
export * from './block'
export * from './formatting'
export * from './insert'
export * from './transform'

// 操作注册表
import type { MenuAction } from '../types'
import { blockActions } from './block'
import { formattingActions } from './formatting'
import { insertActions } from './insert'
import { transformActions } from './transform'

/**
 * 所有可用操作的集合
 */
export const allActions: MenuAction[] = [...transformActions, ...formattingActions, ...blockActions, ...insertActions]

/**
 * 根据 ID 获取操作
 */
export function getActionById(id: string): MenuAction | undefined {
  return allActions.find((action) => action.id === id)
}

/**
 * 获取默认启用的操作 ID 列表
 */
export const defaultEnabledActions = [
  // Transform
  'transform-heading-1',
  'transform-heading-2',
  'transform-heading-3',
  'transform-paragraph',
  'transform-bullet-list',
  'transform-ordered-list',
  'transform-blockquote',
  'transform-code-block',

  // Block operations
  'block-duplicate',
  'block-copy',
  'block-delete',

  // Insert
  'insert-paragraph-after'
]
