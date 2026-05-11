import { Button, ConfirmDialog, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatRelativeTime } from '@renderer/pages/knowledge/utils'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Clock3, FileText, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { statusDotClassNames } from './statusStyles'

interface DetailHeaderProps {
  base: KnowledgeBase
  itemCount: number
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

const DetailHeader = ({ base, itemCount, onRenameBase, onDeleteBase }: DetailHeaderProps) => {
  const { t, i18n } = useTranslation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const formattedUpdatedAt = useMemo(
    () => formatRelativeTime(base.updatedAt, i18n.language),
    [base.updatedAt, i18n.language]
  )
  const statusLabel = t(`knowledge.status.${base.status}`)

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

  return (
    <>
      <header className="flex h-11 shrink-0 items-center justify-between border-border/15 border-b px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex size-6 shrink-0 items-center justify-center rounded text-xs"
            style={{ background: 'rgba(139, 92, 246, 0.125)' }}>
            <span aria-hidden="true">{base.emoji}</span>
          </div>

          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-foreground text-sm">{base.name}</span>
              <span
                className={cn('size-1 shrink-0 rounded-full', statusDotClassNames[base.status])}
                aria-label={statusLabel}
                title={statusLabel}
              />
              <span className="text-muted-foreground/35 text-xs">{statusLabel}</span>
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-muted-foreground/35 text-xs leading-4">
          <div className="flex items-center gap-1">
            <FileText className="size-3" />
            <span>{t('knowledge.meta.documents_count', { count: itemCount })}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock3 className="size-3" />
            <span>{formattedUpdatedAt}</span>
          </div>
          <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground/35 shadow-none hover:bg-accent/60 hover:text-foreground"
                aria-label={t('common.more')}>
                <MoreHorizontal className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={8}
              collisionPadding={8}
              className="w-27.5 min-w-27.5 rounded-lg border-border bg-popover p-1 shadow-xl"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}>
              <MenuList className="gap-0">
                <MenuItem
                  variant="ghost"
                  icon={<PencilLine className="size-2.25" />}
                  label={t('knowledge.context.rename')}
                  className="gap-1.5 rounded-md px-2 py-1 font-normal text-popover-foreground hover:bg-accent"
                  onClick={handleRenameBase}
                />
                <MenuItem
                  variant="ghost"
                  icon={<Trash2 className="size-2.25" />}
                  label={t('knowledge.context.delete')}
                  className="gap-1.5 rounded-md px-2 py-1 font-normal text-red-500 hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-red-500/20"
                  onClick={() => {
                    setIsMenuOpen(false)
                    setIsDeleteDialogOpen(true)
                  }}
                />
              </MenuList>
            </PopoverContent>
          </Popover>
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
