import { loggerService } from '@logger'
import { NavbarCenter, NavbarHeader, NavbarRight } from '@renderer/components/app/Navbar'
import { RowFlex } from '@renderer/components/Layout'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { findNodeInTree } from '@renderer/services/NotesTreeService'
import { Breadcrumb, BreadcrumbProps, Dropdown, Tooltip } from 'antd'
import { t } from 'i18next'
import { MoreHorizontal, PanelLeftClose, PanelRightClose, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import { menuItems } from './MenuConfig'

const logger = loggerService.withContext('HeaderNavbar')

const HeaderNavbar = ({ notesTree, getCurrentNoteContent, onToggleStar }) => {
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const { activeNode } = useActiveNode(notesTree)
  const [breadcrumbItems, setBreadcrumbItems] = useState<Required<BreadcrumbProps>['items']>([])
  const { settings, updateSettings } = useNotesSettings()
  const canShowStarButton = activeNode?.type === 'file' && onToggleStar

  const handleToggleShowWorkspace = useCallback(() => {
    toggleShowWorkspace()
  }, [toggleShowWorkspace])

  const handleToggleStarred = useCallback(() => {
    if (activeNode) {
      onToggleStar(activeNode.id)
    }
  }, [activeNode, onToggleStar])

  const handleCopyContent = useCallback(async () => {
    try {
      const content = getCurrentNoteContent?.()
      if (content) {
        await navigator.clipboard.writeText(content)
        window.toast.success(t('common.copied'))
      } else {
        window.toast.warning(t('notes.no_content_to_copy'))
      }
    } catch (error) {
      logger.error('Failed to copy content:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [getCurrentNoteContent])

  const buildMenuItem = (item: any) => {
    if (item.type === 'divider') {
      return { type: 'divider' as const, key: item.key }
    }

    if (item.type === 'component') {
      return {
        key: item.key,
        label: item.component(settings, updateSettings),
        onClick: () => {} // No-op since component handles its own interactions
      }
    }

    const IconComponent = item.icon

    // Handle submenu items
    if (item.children) {
      return {
        key: item.key,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {IconComponent && <IconComponent size={16} />}
            <span>{t(item.labelKey)}</span>
          </div>
        ),
        children: item.children.map(buildMenuItem)
      }
    }

    return {
      key: item.key,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {IconComponent && <IconComponent size={16} />}
          <span>{t(item.labelKey)}</span>
          {item.isActive?.(settings) && <span style={{ color: 'var(--color-primary)' }}>✓</span>}
        </div>
      ),
      onClick: () => {
        if (item.copyAction) {
          handleCopyContent()
        } else if (item.action) {
          item.action(settings, updateSettings)
        }
      }
    }
  }

  // 构建面包屑路径
  useEffect(() => {
    if (!activeNode || !notesTree) {
      setBreadcrumbItems([])
      return
    }
    const node = findNodeInTree(notesTree, activeNode.id)
    if (!node) return

    const pathParts = node.treePath.split('/').filter(Boolean)
    const items = pathParts.map((part, index) => {
      return {
        key: `path-${index}`,
        title: part
      }
    })

    setBreadcrumbItems(items)
  }, [activeNode, notesTree])

  return (
    <NavbarHeader
      className="home-navbar"
      style={{ justifyContent: 'flex-start', borderBottom: '0.5px solid var(--color-border)' }}>
      <RowFlex className="flex-1 items-center">
        {showWorkspace && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={handleToggleShowWorkspace}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {!showWorkspace && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={handleToggleShowWorkspace}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
      </RowFlex>
      <NavbarCenter style={{ flex: 1 }}>
        <Breadcrumb items={breadcrumbItems} />
      </NavbarCenter>
      <NavbarRight style={{ paddingRight: 0 }}>
        {canShowStarButton && (
          <Tooltip title={activeNode.isStarred ? t('notes.unstar') : t('notes.star')} mouseEnterDelay={0.8}>
            <StarButton onClick={handleToggleStarred}>
              {activeNode.isStarred ? (
                <Star size={18} fill="var(--color-status-warning)" stroke="var(--color-status-warning)" />
              ) : (
                <Star size={18} />
              )}
            </StarButton>
          </Tooltip>
        )}
        <Tooltip title={t('notes.settings.title')} mouseEnterDelay={0.8}>
          <Dropdown
            menu={{ items: menuItems.map(buildMenuItem) }}
            trigger={['click']}
            placement="bottomRight"
            destroyOnHidden={false}>
            <NavbarIcon>
              <MoreHorizontal size={18} />
            </NavbarIcon>
          </Dropdown>
        </Tooltip>
      </NavbarRight>
    </NavbarHeader>
  )
}

export const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  .iconfont {
    font-size: 18px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
    &.icon-appstore {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 16px;
  }
  svg {
    color: var(--color-icon);
    width: 18px;
    height: 18px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

export const StarButton = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  svg {
    color: inherit;
  }

  &:hover {
    background-color: var(--color-background-mute);
  }
`

export default HeaderNavbar
