import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import type { KnowledgeAddItemConflict, KnowledgeItemType } from '@shared/data/types/knowledge'
import { FileText, Folder, Link2, type LucideIcon, StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type ConflictResolution = 'rename' | 'replace'

const CONFLICT_TYPE_ICON: Record<KnowledgeItemType, LucideIcon> = {
  file: FileText,
  note: StickyNote,
  directory: Folder,
  url: Link2
}

interface KnowledgeAddConflictDialogProps {
  open: boolean
  conflicts: KnowledgeAddItemConflict[]
  /** Set while a resolution is being applied; spins the matching action button. */
  pendingResolution: ConflictResolution | null
  onResolve: (resolution: ConflictResolution) => void
  onCancel: () => void
}

const KnowledgeAddConflictDialog = ({
  open,
  conflicts,
  pendingResolution,
  onResolve,
  onCancel
}: KnowledgeAddConflictDialogProps) => {
  const { t } = useTranslation()
  const isResolving = pendingResolution !== null

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isResolving) {
      onCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('knowledge.data_source.add_dialog.conflict_dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('knowledge.data_source.add_dialog.conflict_dialog.description', { count: conflicts.length })}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {conflicts.map((conflict, index) => {
            const Icon = CONFLICT_TYPE_ICON[conflict.type]
            return (
              <li
                key={`${conflict.type}-${conflict.title}-${index}`}
                className="flex items-center gap-2 rounded-md bg-accent/40 px-2.5 py-1.5 text-sm">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{conflict.title}</span>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button
            variant="emphasis"
            onClick={() => onResolve('rename')}
            loading={pendingResolution === 'rename'}
            disabled={isResolving}>
            {t('knowledge.data_source.add_dialog.conflict_dialog.keep_all')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onResolve('replace')}
            loading={pendingResolution === 'replace'}
            disabled={isResolving}>
            {t('knowledge.data_source.add_dialog.conflict_dialog.replace')}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={isResolving}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgeAddConflictDialog
