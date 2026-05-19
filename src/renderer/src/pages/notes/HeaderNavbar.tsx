import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { NavbarCenter, NavbarHeader, NavbarRight } from '@renderer/components/app/Navbar'
import BaseNavbarIcon from '@renderer/components/NavbarIcon'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { findNode } from '@renderer/services/NotesTreeService'
import { t } from 'i18next'
import { Check, ChevronRight, MoreHorizontal, PanelLeftClose, PanelRightClose, Star } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import type { MenuItem as NotesMenuItem } from './MenuConfig'
import { menuItems } from './MenuConfig'
import NotesSettings from './NotesSettings'

const logger = loggerService.withContext('HeaderNavbar')

const HeaderNavbar = ({ notesTree, getCurrentNoteContent, onToggleStar, onExpandPath, onRenameNode }) => {
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const { activeNode } = useActiveNode(notesTree)
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ key: string; title: string; treePath: string; isFolder: boolean }>
  >([])
  const [titleValue, setTitleValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
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

  const handleExportToWord = useCallback(async () => {
    try {
      const content = getCurrentNoteContent?.()
      if (!content) {
        window.toast.warning(t('notes.no_content_to_export'))
        return
      }
      if (!activeNode) {
        window.toast.warning(t('notes.no_note_selected'))
        return
      }
      const fileName = activeNode.name.replace('.md', '')
      await window.api.export.toWord(content, fileName)
    } catch (error) {
      logger.error('Failed to export to Word:', error as Error)
      window.toast.error(t('notes.export_to_word_failed'))
    }
  }, [getCurrentNoteContent, activeNode])

  const handleShowSettings = useCallback(() => {
    void GeneralPopup.show({
      title: t('notes.settings.title'),
      content: <NotesSettings />,
      footer: null,
      width: 600,
      styles: { body: { padding: 0 } }
    })
  }, [])

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

  const renderMenuItem = (item: NotesMenuItem) => {
    if (item.type === 'divider') {
      return <MenuDivider key={item.key} />
    }

    if (item.type === 'component') {
      return <div key={item.key}>{item.component?.(settings, updateSettings)}</div>
    }

    const IconComponent = item.icon

    if (item.children) {
      return (
        <div key={item.key} className="space-y-1">
          <div className="flex items-center gap-2.5 px-2.5 py-1 font-medium text-[11px] text-muted-foreground">
            {IconComponent && <IconComponent size={14} />}
            <span>{t(item.labelKey)}</span>
          </div>
          <div className="pl-3">{item.children.map(renderMenuItem)}</div>
        </div>
      )
    }

    return (
      <MenuItem
        key={item.key}
        label={t(item.labelKey)}
        icon={IconComponent ? <IconComponent size={16} /> : undefined}
        active={item.isActive?.(settings)}
        suffix={item.isActive?.(settings) ? <Check size={14} /> : undefined}
        onClick={() => {
          if (item.copyAction) {
            void handleCopyContent()
          } else if (item.exportToWordAction) {
            void handleExportToWord()
          } else if (item.showSettingsPopup) {
            handleShowSettings()
          } else if (item.action) {
            item.action(settings, updateSettings)
          }
          setMenuOpen(false)
        }}
      />
    )
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
      style={{ justifyContent: 'flex-start', borderBottom: '0.5px solid var(--color-border)', flexShrink: 0 }}>
      <RowFlex className="flex-[0_0_auto] items-center">
        {showWorkspace && (
          <Tooltip title={t('navbar.hide_sidebar')} delay={800}>
            <BaseNavbarIcon
              className="[&_svg]:size-[18px] [&_svg]:text-[var(--color-icon)]"
              onClick={handleToggleShowWorkspace}>
              <PanelLeftClose size={18} />
            </BaseNavbarIcon>
          </Tooltip>
        )}
        {!showWorkspace && (
          <Tooltip title={t('navbar.show_sidebar')} delay={800} placement="right">
            <BaseNavbarIcon
              className="[&_svg]:size-[18px] [&_svg]:text-[var(--color-icon)]"
              onClick={handleToggleShowWorkspace}>
              <PanelRightClose size={18} />
            </BaseNavbarIcon>
          </Tooltip>
        )}
      </RowFlex>
      <NavbarCenter style={{ flex: 1, minWidth: 0 }}>
        <div className="w-full overflow-hidden">
          <Breadcrumb className="[&_[data-slot=breadcrumb-item]:last-child]:min-w-0 [&_[data-slot=breadcrumb-item]:last-child]:flex-1 [&_[data-slot=breadcrumb-list]]:flex-nowrap [&_[data-slot=breadcrumb-list]]:overflow-hidden [&_[data-slot=breadcrumb-list]]:whitespace-nowrap">
            <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden">
              {breadcrumbItems.map((item, index) => {
                const isLastItem = index === breadcrumbItems.length - 1
                const isCurrentNote = isLastItem && !item.isFolder

                return (
                  <Fragment key={item.key}>
                    <BreadcrumbItem className={cn('min-w-0 shrink', isLastItem && 'min-w-0 flex-1')}>
                      {isCurrentNote ? (
                        <div className="flex w-full min-w-0 max-w-none flex-1 items-center">
                          <Input
                            ref={titleInputRef}
                            value={titleValue}
                            onChange={handleTitleChange}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 font-[inherit] text-inherit leading-[inherit] shadow-none outline-none focus-visible:ring-0"
                          />
                        </div>
                      ) : (
                        <span
                          className={cn(
                            'inline-block min-w-0 max-w-[150px] shrink overflow-hidden text-ellipsis whitespace-nowrap',
                            item.isFolder && !isLastItem && 'cursor-pointer hover:text-primary hover:underline'
                          )}
                          onClick={() => handleBreadcrumbClick(item)}>
                          {item.title}
                        </span>
                      )}
                    </BreadcrumbItem>
                    {!isLastItem && (
                      <BreadcrumbSeparator className="mx-2 shrink-0">
                        <ChevronRight size={14} />
                      </BreadcrumbSeparator>
                    )}
                  </Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </NavbarCenter>
      <NavbarRight style={{ paddingRight: 0 }}>
        {canShowStarButton && (
          <Tooltip title={activeNode.isStarred ? t('notes.unstar') : t('notes.star')} delay={800}>
            <div
              className="flex h-[30px] cursor-pointer flex-row items-center justify-center rounded-lg px-[7px] transition-all duration-200 ease-in-out [-webkit-app-region:none] hover:bg-muted [&_svg]:text-[var(--color-icon)]"
              onClick={handleToggleStarred}>
              {activeNode.isStarred ? (
                <Star size={18} fill="var(--color-status-warning)" stroke="var(--color-status-warning)" />
              ) : (
                <Star size={18} />
              )}
            </div>
          </Tooltip>
        )}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <div>
              <Tooltip title={t('notes.settings.title')} delay={800}>
                <BaseNavbarIcon className="[&_svg]:size-[18px] [&_svg]:text-[var(--color-icon)]">
                  <MoreHorizontal size={18} />
                </BaseNavbarIcon>
              </Tooltip>
            </div>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-1.5">
            <MenuList>{menuItems.map(renderMenuItem)}</MenuList>
          </PopoverContent>
        </Popover>
      </NavbarRight>
    </NavbarHeader>
  )
}

export default HeaderNavbar
