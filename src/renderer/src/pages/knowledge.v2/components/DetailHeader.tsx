import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatRelativeTime } from '@renderer/pages/knowledge.v2/utils'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Clock3, FileText, MoreHorizontal, PencilLine } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DetailHeaderProps {
  base: KnowledgeBase
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
}

const DEFAULT_DOCUMENT_COUNT = 0
const DEFAULT_STATUS = 'completed'

const statusClassNames = {
  completed: 'text-muted-foreground/35',
  processing: 'text-amber-400/80',
  failed: 'text-destructive/80'
} as const

const statusTextKeys = {
  completed: 'knowledge_v2.status.completed',
  processing: 'knowledge_v2.status.processing',
  failed: 'knowledge_v2.status.failed'
} as const

const DetailHeader = ({ base, onRenameBase }: DetailHeaderProps) => {
  const { t, i18n } = useTranslation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const formattedUpdatedAt = useMemo(
    () => formatRelativeTime(base.updatedAt, i18n.language),
    [base.updatedAt, i18n.language]
  )

  const handleRenameBase = useCallback(() => {
    setIsMenuOpen(false)
    onRenameBase({
      id: base.id,
      name: base.name
    })
  }, [base.id, base.name, onRenameBase])

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-border/15 border-b px-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/60 text-xs')}>
          <span aria-hidden="true">{base.emoji}</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="truncate text-[0.6875rem] text-foreground leading-4.125">{base.name}</h1>
          <span className={cn('text-[0.5625rem] leading-3.375', statusClassNames[DEFAULT_STATUS])}>
            {t(statusTextKeys[DEFAULT_STATUS])}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
        <div className="flex items-center gap-1">
          <FileText className="size-3" />
          <span>{t('knowledge_v2.meta.documents_count', { count: DEFAULT_DOCUMENT_COUNT })}</span>
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
            className="w-52 rounded-xl p-2"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}>
            <MenuList className="gap-0.5">
              <MenuItem
                variant="ghost"
                icon={<PencilLine className="size-3.5" />}
                label={t('knowledge_v2.context.rename')}
                onClick={handleRenameBase}
              />
            </MenuList>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}

export default DetailHeader
