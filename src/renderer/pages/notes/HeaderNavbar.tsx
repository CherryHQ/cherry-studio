import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  PageSidePanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { NavbarCenter, NavbarHeader, NavbarRight } from '@renderer/components/app/Navbar'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { findNode } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'
import { t } from 'i18next'
import { Check, ChevronRight, MoreHorizontal, PanelLeftClose, PanelRightClose, Star } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import type { MenuItem as NotesMenuItem } from './MenuConfig'
import { menuItems } from './MenuConfig'
import NotesSettings from './NotesSettings'

const logger = loggerService.withContext('HeaderNavbar')

const navIconButtonClassName = ({ active = false }: { active?: boolean } = {}) =>
  cn(
    'rounded-md shadow-none active:scale-95',
    active ? 'text-foreground hover:text-foreground' : 'text-foreground-muted hover:text-foreground'
  )
const navAccentIconButtonClassName = 'rounded-md text-foreground shadow-none hover:text-foreground active:scale-95'
const iconTooltipClassNames = { placeholder: 'inline-flex' }
const notesMenuSectionLabelClassName = 'flex h-8 items-center px-3 text-xs font-normal text-foreground-muted'
const notesSettingsPanelWidthClassName = '!w-[min(500px,calc(100%-1rem))]'
const notesSettingsPanelHeaderClassName = 'h-14 px-6'
const notesSettingsPanelBodyClassName = 'space-y-0 px-6 py-5'

interface HeaderNavbarProps {
  notesTree: NotesTreeNode[]
  activeFilePath?: string
  getCurrentNoteContent?: () => string
  onToggleStar?: (nodeId: string) => void
  onExpandPath?: (treePath: string) => void
  onRenameNode?: (nodeId: string, newName: string) => void
}

const HeaderNavbar = ({
  notesTree,
  activeFilePath,
  getCurrentNoteContent,
  onToggleStar,
  onExpandPath,
  onRenameNode
}: HeaderNavbarProps) => {
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const { activeNode } = useActiveNode(notesTree, activeFilePath)
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ key: string; title: string; treePath: string; isFolder: boolean }>
  >([])
  const [titleValue, setTitleValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { settings, updateSettings } = useNotesSettings()
  const canShowStarButton = activeNode?.type === 'file' && onToggleStar

  const handleToggleShowWorkspace = useCallback(() => {
    toggleShowWorkspace()
  }, [toggleShowWorkspace])

  const handleToggleStarred = useCallback(() => {
    if (activeNode && onToggleStar) {
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
    setSettingsOpen(true)
  }, [])

  const handleBreadcrumbClick = useCallback(
    (item: { treePath: string; isFolder: boolean }) => {
      if (item.isFolder && onExpandPath) {
        onExpandPath(item.treePath)
      }
    },
    [onExpandPath]
  )

  const handleTitleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setTitleValue(e.target.value)
  }, [])

  const handleTitleBlur = useCallback(() => {
    if (activeNode && titleValue.trim() && titleValue.trim() !== activeNode.name.replace('.md', '')) {
      onRenameNode?.(activeNode.id, titleValue.trim())
    } else if (activeNode) {
      setTitleValue(activeNode.name.replace('.md', ''))
    }
  }, [activeNode, titleValue, onRenameNode])

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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

  const renderMenuItem = (item: NotesMenuItem, onSelectClose: () => void) => {
    if (item.type === 'divider') {
      return <MenuDivider key={item.key} />
    }

    if (item.type === 'component') {
      return (
        <div key={item.key} className="px-3 py-1">
          {item.component?.(settings, updateSettings)}
        </div>
      )
    }

    if (item.children) {
      return (
        <div key={item.key}>
          <div className={notesMenuSectionLabelClassName}>{t(item.labelKey)}</div>
          {item.children.map((child) => renderMenuItem(child, onSelectClose))}
        </div>
      )
    }

    const Icon = item.icon
    const isActive = item.isActive?.(settings) ?? false

    return (
      <MenuItem
        key={item.key}
        icon={Icon ? <Icon size={16} /> : undefined}
        label={t(item.labelKey)}
        active={isActive}
        suffix={isActive ? <Check size={16} className="text-foreground" /> : undefined}
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
          onSelectClose()
        }}
      />
    )
  }

  const closeMenu = useCallback(() => setMenuOpen(false), [])

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
    const items = pathParts.map((part: string, index: number) => {
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
    <NavbarHeader className="home-navbar shrink-0 justify-start bg-background [border-bottom:0.5px_solid_var(--color-border-muted)]">
      <RowFlex className="flex-[0_0_auto] items-center gap-0.5">
        {showWorkspace && (
          <Tooltip content={t('navbar.hide_sidebar')} delay={800} classNames={iconTooltipClassNames}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleShowWorkspace}
              className={navIconButtonClassName()}
              aria-label={t('navbar.hide_sidebar')}>
              <PanelLeftClose size={14} />
            </Button>
          </Tooltip>
        )}
        {!showWorkspace && (
          <Tooltip content={t('navbar.show_sidebar')} delay={800} classNames={iconTooltipClassNames}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleShowWorkspace}
              className={navIconButtonClassName()}
              aria-label={t('navbar.show_sidebar')}>
              <PanelRightClose size={14} />
            </Button>
          </Tooltip>
        )}
      </RowFlex>
      <NavbarCenter className="min-w-0 flex-1">
        <div className="w-full overflow-hidden">
          <Breadcrumb className="**:data-[slot=breadcrumb-list]:flex-nowrap **:data-[slot=breadcrumb-list]:overflow-hidden **:data-[slot=breadcrumb-list]:whitespace-nowrap [&_[data-slot=breadcrumb-item]:last-child]:min-w-0 [&_[data-slot=breadcrumb-item]:last-child]:flex-1">
            <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden text-foreground-secondary text-sm">
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
                            className="h-auto min-w-0 flex-1 border-0! bg-transparent! p-0 font-medium text-foreground text-sm leading-[inherit] shadow-none outline-none focus-visible:border-transparent! focus-visible:ring-0! dark:bg-transparent!"
                          />
                        </div>
                      ) : (
                        <span
                          className={cn(
                            'inline-block min-w-0 max-w-37.5 shrink overflow-hidden text-ellipsis whitespace-nowrap',
                            item.isFolder && !isLastItem && 'cursor-pointer hover:text-foreground hover:underline'
                          )}
                          onClick={() => handleBreadcrumbClick(item)}>
                          {item.title}
                        </span>
                      )}
                    </BreadcrumbItem>
                    {!isLastItem && (
                      <BreadcrumbSeparator className="mx-2 shrink-0 text-foreground-muted">
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
      <NavbarRight className="gap-0.5 pr-0">
        {canShowStarButton && (
          <Tooltip
            content={activeNode.isStarred ? t('notes.unstar') : t('notes.star')}
            delay={800}
            classNames={iconTooltipClassNames}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleStarred}
              className={navAccentIconButtonClassName}
              aria-label={activeNode.isStarred ? t('notes.unstar') : t('notes.star')}>
              {activeNode.isStarred ? (
                <Star size={14} fill="var(--color-warning)" stroke="var(--color-warning)" />
              ) : (
                <Star size={14} />
              )}
            </Button>
          </Tooltip>
        )}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={navAccentIconButtonClassName}
              aria-label={t('notes.settings.title')}>
              <Tooltip content={t('notes.settings.title')} delay={800} classNames={iconTooltipClassNames}>
                <span className="flex items-center justify-center">
                  <MoreHorizontal size={14} />
                </span>
              </Tooltip>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" variant="menu">
            <MenuList className="gap-1">{menuItems.map((item) => renderMenuItem(item, closeMenu))}</MenuList>
          </PopoverContent>
        </Popover>
      </NavbarRight>
      <PageSidePanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        closeLabel={t('common.close')}
        header={<span className="font-semibold text-sm">{t('notes.settings.title')}</span>}
        contentClassName={notesSettingsPanelWidthClassName}
        headerClassName={notesSettingsPanelHeaderClassName}
        bodyClassName={notesSettingsPanelBodyClassName}>
        <NotesSettings />
      </PageSidePanel>
    </NavbarHeader>
  )
}

export default HeaderNavbar
