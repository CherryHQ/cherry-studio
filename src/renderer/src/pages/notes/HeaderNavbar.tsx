import { RowFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { NavbarCenter, NavbarHeader, NavbarRight } from '@renderer/components/app/Navbar'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { findNode } from '@renderer/services/NotesTreeService'
import { Breadcrumb, Dropdown, Input, Tooltip } from 'antd'
import { t } from 'i18next'
import { MoreHorizontal, PanelLeftClose, PanelRightClose, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { menuItems } from './MenuConfig'

const logger = loggerService.withContext('HeaderNavbar')

const HeaderNavbar = ({ notesTree, getCurrentNoteContent, onToggleStar, onExpandPath, onRenameNode }) => {
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const { activeNode } = useActiveNode(notesTree)
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ key: string; title: string; treePath: string; isFolder: boolean }>
  >([])
  const [titleValue, setTitleValue] = useState('')
  const titleInputRef = useRef<any>(null)
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

  const handleBreadcrumbClick = useCallback(
    (item: { treePath: string; isFolder: boolean }) => {
      if (item.isFolder && onExpandPath) {
        onExpandPath(item.treePath)
      }
    },
    [onExpandPath]
  )

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleValue(e.target.value)
  }, [])

  const handleTitleBlur = useCallback(() => {
    if (activeNode && titleValue.trim() && titleValue.trim() !== activeNode.name.replace('.md', '')) {
      onRenameNode?.(activeNode.id, titleValue.trim())
    } else if (activeNode) {
      // 如果没有更改或为空，恢复原始值
      setTitleValue(activeNode.name.replace('.md', ''))
    }
  }, [activeNode, titleValue, onRenameNode])

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        titleInputRef.current?.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (activeNode) {
          setTitleValue(activeNode.name.replace('.md', ''))
        }
        titleInputRef.current?.blur()
      }
    },
    [activeNode]
  )

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

  // 同步标题值
  useEffect(() => {
    if (activeNode?.type === 'file') {
      setTitleValue(activeNode.name.replace('.md', ''))
    }
  }, [activeNode])

  // 构建面包屑路径
  useEffect(() => {
    if (!activeNode || !notesTree) {
      setBreadcrumbItems([])
      return
    }
    const node = findNode(notesTree, activeNode.id)
    if (!node) return

    const pathParts = node.treePath.split('/').filter(Boolean)
    const items = pathParts.map((part, index) => {
      const currentPath = '/' + pathParts.slice(0, index + 1).join('/')
      const isLastItem = index === pathParts.length - 1
      return {
        key: `path-${index}`,
        title: part,
        treePath: currentPath,
        isFolder: !isLastItem || node.type === 'folder'
      }
    })

    setBreadcrumbItems(items)
  }, [activeNode, notesTree])

  return (
    <NavbarHeader
      className="home-navbar"
      style={{ justifyContent: 'flex-start', borderBottom: '0.5px solid var(--color-border)' }}>
      <RowFlex className="flex-[0_0_auto] items-center">
        {showWorkspace && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={handleToggleShowWorkspace}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {!showWorkspace && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8} placement="right">
            <NavbarIcon onClick={handleToggleShowWorkspace}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
      </RowFlex>
      <NavbarCenter style={{ flex: 1, minWidth: 0 }}>
        <BreadcrumbsContainer>
          <Breadcrumb
            separator={'>'}
            items={breadcrumbItems.map((item, index) => {
              const isLastItem = index === breadcrumbItems.length - 1
              const isCurrentNote = isLastItem && !item.isFolder
              return {
                title: (
                  <div key={item.key} className="flex">
                    {isCurrentNote ? (
                      <TitleInputWrapper>
                        <TitleInput
                          ref={titleInputRef}
                          value={titleValue}
                          onChange={handleTitleChange}
                          onBlur={handleTitleBlur}
                          onKeyDown={handleTitleKeyDown}
                          size="small"
                          variant="borderless"
                          style={{
                            fontSize: 'inherit',
                            padding: 0,
                            height: 'auto',
                            lineHeight: 'inherit'
                          }}
                        />
                      </TitleInputWrapper>
                    ) : (
                      <BreadcrumbTitle
                        onClick={() => handleBreadcrumbClick(item)}
                        $clickable={item.isFolder && !isLastItem}>
                        {item.title}
                      </BreadcrumbTitle>
                    )}
                  </div>
                )
              }
            })}></Breadcrumb>
        </BreadcrumbsContainer>
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

export const BreadcrumbsContainer = styled.div`
  width: 100%;
  overflow: hidden;

  /* 确保 HeroUI Breadcrumbs 组件保持在一行 */
  & > nav {
    white-space: nowrap;
    overflow: hidden;
  }

  & ol {
    flex-wrap: nowrap !important;
    overflow: hidden;
    display: flex;
    align-items: center;
  }

  & li {
    flex-shrink: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  /* 最后一个面包屑项（当前笔记）可以扩展 */
  & li:last-child {
    flex: 1 !important;
    min-width: 0 !important;
    max-width: none !important;
  }

  /* 更强的样式覆盖 */
  & li:last-child * {
    max-width: none !important;
  }

  & li:last-child > * {
    flex: 1 !important;
    width: 100% !important;
  }

  /* 确保分隔符不会与标题重叠 */
  & li:not(:last-child)::after {
    flex-shrink: 0;
    margin: 0 8px;
  }
`

export const BreadcrumbTitle = styled.span<{ $clickable?: boolean }>`
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  flex-shrink: 1;
  min-width: 0;

  ${({ $clickable }) =>
    $clickable &&
    `
    cursor: pointer;
    &:hover {
      color: var(--color-primary);
      text-decoration: underline;
    }
  `}
`

export const TitleInputWrapper = styled.div`
  width: 100%;
  flex: 1;
  min-width: 0;
  max-width: none;
  display: flex;
  align-items: center;
`

export const TitleInput = styled(Input)`
  &&& {
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
    color: inherit !important;
    font-size: inherit !important;
    font-weight: inherit !important;
    font-family: inherit !important;
    padding: 0 !important;
    height: auto !important;
    line-height: inherit !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    flex: 1 !important;

    &:focus,
    &:hover {
      border: none !important;
      box-shadow: none !important;
      background: transparent !important;
    }

    &::placeholder {
      color: var(--color-text-3) !important;
    }

    input {
      border: none !important;
      box-shadow: none !important;
      background: transparent !important;
      color: inherit !important;
      font-size: inherit !important;
      font-weight: inherit !important;
      font-family: inherit !important;
      padding: 0 !important;
      height: auto !important;
      line-height: inherit !important;
      width: 100% !important;

      &:focus,
      &:hover {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
      }
    }
  }
`

export default HeaderNavbar
