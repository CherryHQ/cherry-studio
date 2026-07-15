import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface KnowledgeRowActionsMenuProps {
  /** Same item model the row's right-click menu uses, so both entry points stay in sync. */
  items: readonly CommandContextMenuExtraItem[]
  className?: string
}

/**
 * Hover-revealed "more" button that opens the row's action menu on click — sharing the exact
 * item model as the row's right-click menu. Used by both the knowledge-base navigator rows and
 * the data-source item rows. The host row must set `group/row` for the reveal-on-hover to work.
 */
const KnowledgeRowActionsMenu = ({ items, className }: KnowledgeRowActionsMenuProps) => {
  const { t } = useTranslation()

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={items} align="end" side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.more')}
        // Keep the click from also activating the row (select base / open source / drill in).
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'size-6 rounded-md text-foreground/70 opacity-0 transition-[opacity,color,background-color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:opacity-100',
          className
        )}>
        <MoreHorizontal className="size-3.5" />
      </Button>
    </CommandPopupMenu>
  )
}

export default KnowledgeRowActionsMenu
