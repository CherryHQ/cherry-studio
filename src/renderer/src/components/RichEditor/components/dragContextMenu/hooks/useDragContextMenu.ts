import { loggerService } from '@logger'
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import React, { useCallback, useRef, useState } from 'react'

import type { EventHandlers, MenuAction, MenuActionResult, PositionOptions, UseDragContextMenuReturn } from '../types'

const logger = loggerService.withContext('useDragContextMenu')

interface UseDragContextMenuOptions {
  /** 编辑器实例 */
  editor: Editor
  /** 事件处理器 */
  eventHandlers?: EventHandlers
  /** 位置计算选项 */
  positionOptions?: PositionOptions
}

/**
 * 拖拽上下文菜单核心逻辑 Hook
 */
export function useDragContextMenu({
  editor,
  eventHandlers,
  positionOptions
}: UseDragContextMenuOptions): UseDragContextMenuReturn {
  // 菜单状态
  const [isMenuVisible, setIsMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const [currentNode, setCurrentNode] = useState<{ node: Node; position: number } | null>(null)

  // 引用
  const menuRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  /**
   * 计算菜单位置
   */
  const calculateMenuPosition = useCallback(
    (clientPos: { x: number; y: number }) => {
      const { offset = { x: 10, y: 0 }, boundary, autoAdjust = true } = positionOptions || {}

      let x = clientPos.x + offset.x
      let y = clientPos.y + offset.y

      if (autoAdjust) {
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const menuWidth = 280 // 预估菜单宽度
        const menuHeight = 400 // 预估菜单最大高度

        // 水平位置调整
        if (x + menuWidth > viewportWidth) {
          x = clientPos.x - menuWidth - offset.x
        }

        // 垂直位置调整
        if (y + menuHeight > viewportHeight) {
          y = Math.max(10, viewportHeight - menuHeight - 10)
        }

        // 边界约束
        if (boundary) {
          const rect = boundary.getBoundingClientRect()
          x = Math.max(rect.left, Math.min(x, rect.right - menuWidth))
          y = Math.max(rect.top, Math.min(y, rect.bottom - menuHeight))
        }
      }

      return { x, y }
    },
    [positionOptions]
  )

  /**
   * 显示菜单
   */
  const showMenu = useCallback(
    (node: Node, position: number, clientPos: { x: number; y: number }) => {
      try {
        logger.debug('Showing context menu', {
          nodeType: node.type.name,
          position,
          clientPos
        })

        // 清除之前的延时隐藏
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = undefined
        }

        const menuPos = calculateMenuPosition(clientPos)

        setCurrentNode({ node, position })
        setMenuPosition(menuPos)
        setIsMenuVisible(true)

        // 触发事件
        eventHandlers?.onMenuShow?.(node, position)
      } catch (error) {
        logger.error('Failed to show menu', error as Error)
        eventHandlers?.onError?.(error as Error, 'showMenu')
      }
    },
    [calculateMenuPosition, eventHandlers]
  )

  /**
   * 隐藏菜单
   */
  const hideMenu = useCallback(() => {
    try {
      logger.debug('Hiding context menu')

      setIsMenuVisible(false)
      setCurrentNode(null)

      // 延时清理位置，以便动画完成
      timeoutRef.current = setTimeout(() => {
        setMenuPosition({ x: 0, y: 0 })
      }, 200)

      // 触发事件
      eventHandlers?.onMenuHide?.()
    } catch (error) {
      logger.error('Failed to hide menu', error as Error)
      eventHandlers?.onError?.(error as Error, 'hideMenu')
    }
  }, [eventHandlers])

  /**
   * 执行菜单操作
   */
  const executeAction = useCallback(
    async (action: MenuAction): Promise<MenuActionResult> => {
      if (!currentNode) {
        const error = new Error('No current node available')
        logger.error('Cannot execute action without current node', error)
        return { success: false, error: error.message }
      }

      try {
        logger.debug('Executing menu action', {
          actionId: action.id,
          nodeType: currentNode.node.type.name,
          position: currentNode.position
        })

        // 检查操作是否可用
        if (!action.isEnabled(editor, currentNode.node, currentNode.position)) {
          const error = 'Action is not enabled for current context'
          logger.warn('Action not enabled', { actionId: action.id })
          return { success: false, error }
        }

        // 执行操作
        action.execute(editor, currentNode.node, currentNode.position)

        const result: MenuActionResult = {
          success: true,
          shouldCloseMenu: true // 默认执行后关闭菜单
        }

        // 触发事件
        eventHandlers?.onActionExecute?.(action, result)

        // 自动关闭菜单
        if (result.shouldCloseMenu !== false) {
          hideMenu()
        }

        logger.debug('Action executed successfully', { actionId: action.id })
        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Failed to execute action', error as Error, {
          actionId: action.id,
          nodeType: currentNode.node.type.name
        })

        const result: MenuActionResult = {
          success: false,
          error: errorMessage
        }

        eventHandlers?.onActionExecute?.(action, result)
        eventHandlers?.onError?.(error as Error, `executeAction:${action.id}`)

        return result
      }
    },
    [currentNode, editor, eventHandlers, hideMenu]
  )

  /**
   * 监听编辑器变化，自动隐藏菜单
   */
  const handleEditorUpdate = useCallback(() => {
    if (isMenuVisible) {
      // 检查当前节点是否仍然有效
      if (currentNode) {
        try {
          const doc = editor.state.doc
          const pos = currentNode.position

          // 检查位置是否仍然有效
          if (pos >= 0 && pos < doc.content.size) {
            const resolvedPos = doc.resolve(pos)
            const nodeAtPos = resolvedPos.nodeAfter || resolvedPos.parent

            // 如果节点类型或内容发生变化，隐藏菜单
            if (nodeAtPos?.type.name !== currentNode.node.type.name) {
              hideMenu()
            }
          } else {
            // 位置无效，隐藏菜单
            hideMenu()
          }
        } catch (error) {
          logger.warn('Invalid node position, hiding menu', error as Error)
          hideMenu()
        }
      }
    }
  }, [isMenuVisible, currentNode, editor, hideMenu])

  // 监听编辑器更新
  React.useEffect(() => {
    if (!editor) return

    editor.on('update', handleEditorUpdate)
    editor.on('blur', hideMenu)

    return () => {
      editor.off('update', handleEditorUpdate)
      editor.off('blur', hideMenu)

      // 清理定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [editor, handleEditorUpdate, hideMenu])

  // 监听全局点击事件，点击菜单外部时隐藏
  React.useEffect(() => {
    if (!isMenuVisible) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as HTMLElement)) {
        hideMenu()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideMenu()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isMenuVisible, hideMenu])

  return {
    isMenuVisible,
    menuPosition,
    currentNode,
    showMenu,
    hideMenu,
    executeAction
  }
}
