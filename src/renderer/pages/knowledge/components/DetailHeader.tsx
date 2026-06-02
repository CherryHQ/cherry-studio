import {
  Badge,
  Button,
  ConfirmDialog,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput
} from '@cherrystudio/ui'
import { formatRelativeTime } from '@renderer/pages/knowledge/utils'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MoreHorizontal, PencilLine, Search, SlidersHorizontal, Trash2, Zap } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeBaseIcon from './KnowledgeBaseIcon'
import { statusBadgeClassNames } from './statusStyles'

interface DetailHeaderProps {
  base: KnowledgeBase
  itemCount: number
  searchQuery?: string
  onSearchChange?: (value: string) => void
  onOpenRagConfig: () => void
  onOpenRecallTest: () => void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

const DetailHeader = ({
  base,
  itemCount,
  searchQuery = '',
  onSearchChange,
  onOpenRagConfig,
  onOpenRecallTest,
  onRenameBase,
  onDeleteBase
}: DetailHeaderProps) => {
  const { t, i18n } = useTranslation()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const canSearch = Boolean(onSearchChange)
  const isSearchVisible = isSearchOpen || searchQuery.length > 0

  const formattedUpdatedAt = useMemo(
    () => formatRelativeTime(base.updatedAt, i18n.language),
    [base.updatedAt, i18n.language]
  )
  const statusLabelKey = `knowledge.status.${base.status}` as const
  const statusLabel = t(statusLabelKey)

  const handleRenameBase = useCallback(() => {
    setIsMenuOpen(false)
    onRenameBase({
      id: base.id,
      name: base.name
    })
  }, [base.id, base.name, onRenameBase])

  const handleDeleteBase = useCallback(async () => {
    await onDeleteBase(base.id)
    setIsDeleteDialogOpen(false)
  }, [base.id, onDeleteBase])

  const handleSearchBlur = useCallback(() => {
    if (searchQuery.length === 0) {
      setIsSearchOpen(false)
    }
  }, [searchQuery])

  const handleSearchClear = useCallback(() => {
    onSearchChange?.('')
    setIsSearchOpen(false)
  }, [onSearchChange])

  return (
    <>
      <header className="shrink-0 px-3 py-3.5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <KnowledgeBaseIcon />

            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 truncate font-bold text-2xl text-foreground leading-8">{base.name}</h1>
                <Badge
                  variant="outline"
                  className={`${statusBadgeClassNames[base.status]} shrink-0`}
                  aria-label={statusLabel}
                  title={statusLabel}>
                  {statusLabel}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground-muted text-xs leading-4">
                <span>{t('knowledge.meta.data_sources_count', { count: itemCount })}</span>
                <span aria-hidden="true">·</span>
                <span>{t('knowledge.meta.updated_at', { time: formattedUpdatedAt })}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {canSearch ? (
              isSearchVisible ? (
                <div className="w-36 shrink-0 [&_[data-slot=input-group-addon]]:py-1 [&_[data-slot=input-group-control]]:h-7 [&_[data-slot=input-group-control]]:py-0 [&_[data-slot=input-group]]:h-7">
                  <SearchInput
                    autoFocus
                    value={searchQuery}
                    className="h-7 py-0 text-xs"
                    placeholder={t('knowledge.data_source.toolbar.search_placeholder')}
                    onChange={(event) => onSearchChange?.(event.target.value)}
                    onBlur={handleSearchBlur}
                    onClear={handleSearchClear}
                    clearLabel={t('common.clear')}
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('knowledge.data_source.toolbar.search_placeholder')}
                  onClick={() => setIsSearchOpen(true)}>
                  <Search size={14} />
                </Button>
              )
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('knowledge.tabs.rag_config')}
              onClick={onOpenRagConfig}>
              <SlidersHorizontal size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('knowledge.tabs.recall_test')}
              onClick={onOpenRecallTest}>
              <Zap size={14} />
            </Button>
            <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                  <MoreHorizontal size={14} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                sideOffset={8}
                collisionPadding={8}
                className="w-27.5 min-w-27.5 rounded-lg border-border bg-popover p-1 shadow-md"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}>
                <MenuList>
                  <MenuItem
                    variant="ghost"
                    icon={<PencilLine className="size-3.5" />}
                    label={t('knowledge.context.rename')}
                    onClick={handleRenameBase}
                  />
                  <MenuItem
                    variant="ghost"
                    icon={<Trash2 className="size-3.5" />}
                    label={t('knowledge.context.delete')}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
                    onClick={() => {
                      setIsMenuOpen(false)
                      setIsDeleteDialogOpen(true)
                    }}
                  />
                </MenuList>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge.context.delete_confirm_title')}
        description={t('knowledge.context.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteBase}
      />
    </>
  )
}

export default DetailHeader
