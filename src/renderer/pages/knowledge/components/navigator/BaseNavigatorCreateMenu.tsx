import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { FolderPlus, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorCreateMenuProps } from './types'

const BaseNavigatorCreateMenu = ({ onCreateBase, onCreateGroup }: BaseNavigatorCreateMenuProps) => {
  const { t } = useTranslation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    setIsMenuOpen(true)
  }, [clearCloseTimer])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      setIsMenuOpen(false)
      closeTimerRef.current = null
    }, 120)
  }, [clearCloseTimer])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const handleCreateBase = useCallback(() => {
    clearCloseTimer()
    setIsMenuOpen(false)
    onCreateBase()
  }, [clearCloseTimer, onCreateBase])

  const handleCreateGroup = useCallback(() => {
    clearCloseTimer()
    setIsMenuOpen(false)
    onCreateGroup()
  }, [clearCloseTimer, onCreateGroup])

  return (
    <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-8 shrink-0 rounded-[10px]"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={t('common.add')}
          onClick={openMenu}
          onFocus={openMenu}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}>
          <Plus className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
        className="w-45 rounded-xl border-border bg-popover p-1.5 shadow-md"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        <MenuList role="menu" className="gap-1">
          <MenuItem
            role="menuitem"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            label={t('knowledge.add.title')}
            className="h-8 rounded-lg px-2.5 text-sm"
            onClick={handleCreateBase}
          />
          <MenuItem
            role="menuitem"
            variant="ghost"
            icon={<FolderPlus className="size-3.5" />}
            label={t('knowledge.groups.add')}
            className="h-8 rounded-lg px-2.5 text-sm"
            onClick={handleCreateGroup}
          />
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export default BaseNavigatorCreateMenu
