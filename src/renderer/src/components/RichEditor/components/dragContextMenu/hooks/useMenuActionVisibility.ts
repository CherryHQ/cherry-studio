import { loggerService } from '@logger'
import { useCallback, useMemo } from 'react'

import type { MenuAction, MenuVisibilityOptions, UseMenuActionVisibilityReturn } from '../types'
import { ActionGroup } from '../types'

const logger = loggerService.withContext('useMenuActionVisibility')

/**
 * 菜单操作可见性管理 Hook
 */
export function useMenuActionVisibility({
  editor,
  node,
  position,
  customRules
}: MenuVisibilityOptions): UseMenuActionVisibilityReturn {
  /**
   * 计算可见的操作列表
   */
  const visibleActions = useMemo(() => {
    if (!editor || !node) {
      return []
    }

    try {
      // 获取所有已注册的操作
      const allActions = getRegisteredActions()

      // 过滤可用的操作
      const filtered = allActions.filter((action) => {
        try {
          // 基础可用性检查
          if (!action.isEnabled(editor, node, position)) {
            return false
          }

          // 自定义规则检查
          if (customRules) {
            const customResult = customRules.every((rule) => rule(editor, node, position))
            if (!customResult) {
              return false
            }
          }

          return true
        } catch (error) {
          logger.warn('Error checking action visibility', error as Error, { actionId: action.id })
          return false
        }
      })

      logger.debug('Filtered visible actions', {
        total: allActions.length,
        visible: filtered.length,
        nodeType: node.type.name,
        position
      })

      return filtered
    } catch (error) {
      logger.error('Failed to calculate visible actions', error as Error)
      return []
    }
  }, [editor, node, position, customRules])

  /**
   * 按组分类的操作
   */
  const actionsByGroup = useMemo(() => {
    const grouped: Record<ActionGroup, MenuAction[]> = {
      [ActionGroup.TRANSFORM]: [],
      [ActionGroup.FORMAT]: [],
      [ActionGroup.BLOCK]: [],
      [ActionGroup.INSERT]: [],
      [ActionGroup.AI]: []
    }

    visibleActions.forEach((action) => {
      if (grouped[action.group]) {
        grouped[action.group].push(action)
      }
    })

    return grouped
  }, [visibleActions])

  /**
   * 刷新可见性 - 强制重新计算
   */
  const refreshVisibility = useCallback(() => {
    // 这个函数主要用于外部强制刷新，实际的刷新通过依赖项自动处理
    logger.debug('Visibility refresh requested')
  }, [])

  return {
    visibleActions,
    actionsByGroup,
    refreshVisibility
  }
}

import { allActions } from '../actions'

/**
 * 获取已注册的操作
 */
function getRegisteredActions(): MenuAction[] {
  return allActions
}
