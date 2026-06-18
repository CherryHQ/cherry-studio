import {
  Badge,
  Button,
  ConfirmDialog,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { FlaskConical, MoreHorizontal, PencilLine, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeBaseIcon from './KnowledgeBaseIcon'
import { statusBadgeClassNames } from './statusStyles'

interface DetailHeaderProps {
  base: KnowledgeBase
  onOpenRagConfig: () => void
  onOpenRecallTest: () => void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

const DetailHeader = ({ base, onOpenRagConfig, onOpenRecallTest, onRenameBase, onDeleteBase }: DetailHeaderProps) => {
  const { t } = useTranslation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

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

  return (
    <>
      <header className="shrink-0 px-3 pt-3.5 pb-2">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <KnowledgeBaseIcon />

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
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenRecallTest}>
              <FlaskConical size={14} />
              {t('knowledge.tabs.recall_test')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('knowledge.tabs.rag_config')}
              onClick={onOpenRagConfig}>
              <SlidersHorizontal size={14} />
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
                className="w-40 min-w-40 rounded-lg border-border bg-popover p-1 shadow-md"
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
