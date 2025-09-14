import { loggerService } from '@logger'
import React, { useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useMenuActionVisibility } from './hooks/useMenuActionVisibility'
import {
  EmptyState,
  MenuContainer,
  MenuDivider,
  MenuGroup,
  MenuGroupTitle,
  MenuItem,
  MenuItemIcon,
  MenuItemLabel,
  MenuItemShortcut
} from './styles'
import type { ActionGroup, DragContextMenuProps, MenuAction } from './types'

const logger = loggerService.withContext('DragContextMenu')

/**
 * 操作组显示名称映射
 */
const GROUP_LABELS: Record<ActionGroup, string> = {
  transform: 'Transform',
  format: 'Format',
  block: 'Actions',
  insert: 'Insert',
  ai: 'AI'
}

/**
 * 操作组显示顺序
 */
const GROUP_ORDER: ActionGroup[] = [
  'transform' as ActionGroup,
  'format' as ActionGroup,
  'insert' as ActionGroup,
  'block' as ActionGroup,
  'ai' as ActionGroup
]

/**
 * 拖拽上下文菜单主组件
 */
const DragContextMenu: React.FC<DragContextMenuProps> = ({
  editor,
  node,
  position,
  visible,
  menuPosition,
  onClose,
  customActions = [],
  disabledActions = []
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // 获取菜单操作可见性
  const { visibleActions } = useMenuActionVisibility({
    editor,
    node,
    position
  })

  /**
   * 合并自定义操作
   */
  const allActions = useMemo(() => {
    const actions = [...visibleActions, ...customActions]
    // 过滤被禁用的操作
    return actions.filter((action) => !disabledActions.includes(action.id))
  }, [visibleActions, customActions, disabledActions])

  /**
   * 按组分类的最终操作列表
   */
  const finalActionsByGroup = useMemo(() => {
    const grouped: Record<ActionGroup, MenuAction[]> = {
      transform: [],
      format: [],
      block: [],
      insert: [],
      ai: []
    }

    allActions.forEach((action) => {
      if (grouped[action.group]) {
        grouped[action.group].push(action)
      }
    })

    return grouped
  }, [allActions])

  /**
   * 处理菜单项点击
   */
  const handleMenuItemClick = useCallback(
    async (action: MenuAction) => {
      try {
        logger.debug('Menu item clicked', {
          actionId: action.id,
          nodeType: node.type.name,
          position
        })

        // 执行操作
        action.execute(editor, node, position)

        // 关闭菜单
        onClose()

        logger.debug('Menu action executed successfully', { actionId: action.id })
      } catch (error) {
        logger.error('Failed to execute menu action', error as Error, {
          actionId: action.id,
          nodeType: node.type.name
        })

        // 即使失败也关闭菜单
        onClose()
      }
    },
    [editor, node, position, onClose]
  )

  /**
   * 处理键盘导航
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          event.preventDefault()
          // TODO: 实现键盘导航
          break
        case 'ArrowUp':
          event.preventDefault()
          // TODO: 实现键盘导航
          break
        case 'Enter':
          event.preventDefault()
          // TODO: 执行选中的操作
          break
      }
    },
    [onClose]
  )

  /**
   * 渲染菜单组
   */
  const renderMenuGroup = useCallback(
    (group: ActionGroup, actions: MenuAction[]) => {
      if (actions.length === 0) return null

      return (
        <MenuGroup key={group}>
          <MenuGroupTitle>{GROUP_LABELS[group]}</MenuGroupTitle>
          {actions.map((action) => (
            <MenuItem
              key={action.id}
              $danger={action.danger}
              onClick={() => handleMenuItemClick(action)}
              disabled={!action.isEnabled(editor, node, position)}
              title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}>
              {action.icon && <MenuItemIcon>{action.icon}</MenuItemIcon>}
              <MenuItemLabel>{action.label}</MenuItemLabel>
              {action.shortcut && <MenuItemShortcut>{action.shortcut}</MenuItemShortcut>}
            </MenuItem>
          ))}
        </MenuGroup>
      )
    },
    [editor, node, position, handleMenuItemClick]
  )

  // 如果菜单不可见，不渲染
  if (!visible) return null

  // 如果没有可用操作，显示空状态
  if (allActions.length === 0) {
    const emptyMenu = (
      <MenuContainer
        ref={menuRef}
        $visible={visible}
        style={{
          left: menuPosition.x,
          top: menuPosition.y
        }}
        onKeyDown={handleKeyDown}
        tabIndex={-1}>
        <EmptyState>No actions available for this block</EmptyState>
      </MenuContainer>
    )

    return createPortal(emptyMenu, document.body)
  }

  // 渲染完整菜单
  const menu = (
    <MenuContainer
      ref={menuRef}
      $visible={visible}
      style={{
        left: menuPosition.x,
        top: menuPosition.y
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-testid="drag-context-menu">
      {GROUP_ORDER.map((group, index) => {
        const actions = finalActionsByGroup[group]
        const groupElement = renderMenuGroup(group, actions)

        if (!groupElement) return null

        return (
          <React.Fragment key={group}>
            {groupElement}
            {/* 在组之间添加分隔线，除了最后一个组 */}
            {index < GROUP_ORDER.length - 1 &&
              actions.length > 0 &&
              GROUP_ORDER.slice(index + 1).some((g) => finalActionsByGroup[g].length > 0) && <MenuDivider />}
          </React.Fragment>
        )
      })}
    </MenuContainer>
  )

  return createPortal(menu, document.body)
}

DragContextMenu.displayName = 'DragContextMenu'

export default DragContextMenu
