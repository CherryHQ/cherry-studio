import { Folder, Link2, type LucideIcon, StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { FileIcon } from '@renderer/components/icons/FileIcon'
import type { KnowledgeAddItemConflict, KnowledgeItemType } from '@shared/data/types/knowledge'

type ConflictResolution = 'rename' | 'replace'

const CONFLICT_TYPE_ICON: Record<Exclude<KnowledgeItemType, 'file'>, LucideIcon> = {
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
            const Icon = conflict.type === 'file' ? null : CONFLICT_TYPE_ICON[conflict.type]
            return (
              <li
                key={`${conflict.type}-${conflict.title}-${index}`}
                className="flex items-center gap-2 rounded-md bg-accent/40 px-2.5 py-1.5 text-sm">
                {Icon ? (
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileIcon path={conflict.title} className="size-4 shrink-0" />
                )}
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
