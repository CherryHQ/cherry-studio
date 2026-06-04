import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'

interface DataSourcePanelHeaderProps {
  readyCount: number
  totalCount: number
  selectedCount: number
  onBulkReindex: () => void
  onBulkDelete: () => void
  onCancelBulk: () => void
  onAdd: (source: KnowledgeItemType) => void
}

const DataSourcePanelHeader = ({
  readyCount,
  totalCount,
  selectedCount,
  onBulkReindex,
  onBulkDelete,
  onCancelBulk,
  onAdd
}: DataSourcePanelHeaderProps) => {
  const { t } = useTranslation()
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false)
  const sourceMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSourceMenuCloseTimer = useCallback(() => {
    if (sourceMenuCloseTimerRef.current) {
      clearTimeout(sourceMenuCloseTimerRef.current)
      sourceMenuCloseTimerRef.current = null
    }
  }, [])

  const openSourceMenu = useCallback(() => {
    clearSourceMenuCloseTimer()
    setIsSourceMenuOpen(true)
  }, [clearSourceMenuCloseTimer])

  const scheduleSourceMenuClose = useCallback(() => {
    clearSourceMenuCloseTimer()
    sourceMenuCloseTimerRef.current = setTimeout(() => {
      setIsSourceMenuOpen(false)
      sourceMenuCloseTimerRef.current = null
    }, 120)
  }, [clearSourceMenuCloseTimer])

  const handleSourceSelect = useCallback(
    (source: KnowledgeItemType) => {
      clearSourceMenuCloseTimer()
      setIsSourceMenuOpen(false)
      onAdd(source)
    },
    [clearSourceMenuCloseTimer, onAdd]
  )

  useEffect(() => clearSourceMenuCloseTimer, [clearSourceMenuCloseTimer])

  if (selectedCount > 0) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground text-sm">
            {t('knowledge.data_source.bulk.selected_count', { count: selectedCount })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelBulk}>
            {t('knowledge.data_source.bulk.cancel')}
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onBulkReindex}>
            <RefreshCw className="size-3.5" />
            {t('knowledge.data_source.bulk.reindex')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onBulkDelete}>
            <Trash2 className="size-3.5" />
            {t('knowledge.data_source.bulk.delete')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <div className="flex shrink-0 items-center gap-2">
        {totalCount > 0 ? (
          <span className="text-foreground-muted text-xs leading-4">
            {t('knowledge.data_source.ready_summary', { ready: readyCount, total: totalCount })}
          </span>
        ) : null}

        <Popover open={isSourceMenuOpen} onOpenChange={setIsSourceMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={isSourceMenuOpen}
              className="min-h-0 rounded-lg px-3 py-1.5 font-medium text-foreground-secondary text-sm leading-5 shadow-none hover:bg-accent hover:text-foreground"
              onClick={openSourceMenu}
              onFocus={openSourceMenu}
              onMouseEnter={openSourceMenu}
              onMouseLeave={scheduleSourceMenuClose}>
              <Plus className="size-3.5" />
              {t('knowledge.data_source.toolbar.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="top"
            sideOffset={8}
            collisionPadding={8}
            className="w-[var(--radix-popover-trigger-width)] rounded-xl p-1.5"
            onMouseEnter={openSourceMenu}
            onMouseLeave={scheduleSourceMenuClose}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}>
            <MenuList role="menu" className="gap-1">
              {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
                <MenuItem
                  key={source.value}
                  role="menuitem"
                  variant="ghost"
                  label={t(source.labelKey)}
                  className="h-8 rounded-lg px-2.5 text-sm"
                  onClick={() => handleSourceSelect(source.value)}
                />
              ))}
            </MenuList>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export default DataSourcePanelHeader
