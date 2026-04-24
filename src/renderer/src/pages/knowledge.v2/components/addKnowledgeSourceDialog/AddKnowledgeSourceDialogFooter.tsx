import { Button, DialogClose } from '@cherrystudio/ui'
import type { KnowledgeDataSourceType } from '@renderer/pages/knowledge.v2/types'
import { useTranslation } from 'react-i18next'

interface AddKnowledgeSourceDialogFooterProps {
  activeSource: KnowledgeDataSourceType
  canSubmit: boolean
  isSubmitting: boolean
  selectedDirectoryCount: number
  selectedFileCount: number
  onSubmit: () => void | Promise<void>
}

const AddKnowledgeSourceDialogFooter = ({
  activeSource,
  canSubmit,
  isSubmitting,
  selectedDirectoryCount,
  selectedFileCount,
  onSubmit
}: AddKnowledgeSourceDialogFooterProps) => {
  const { t } = useTranslation()

  const selectionCount =
    activeSource === 'file' ? selectedFileCount : activeSource === 'directory' ? selectedDirectoryCount : 0

  const selectionText =
    activeSource === 'file'
      ? t('knowledge_v2.data_source.add_dialog.footer.selected_files', { count: selectedFileCount })
      : activeSource === 'directory'
        ? t('knowledge_v2.data_source.add_dialog.footer.selected_directories', { count: selectedDirectoryCount })
        : ''

  return (
    <div className="flex shrink-0 items-center justify-between border-border/15 border-t px-4 py-2.5">
      <span className="text-[9px] text-muted-foreground/30 leading-4">{selectionCount > 0 ? selectionText : ''}</span>

      <div className="flex gap-1.5">
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-6 min-h-6 rounded-md px-2.5 text-[11px] text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground">
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={!canSubmit || isSubmitting}
          loading={isSubmitting}
          onClick={() => void onSubmit()}
          className="h-6 min-h-6 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-40">
          {t('common.add')}
        </Button>
      </div>
    </div>
  )
}

export default AddKnowledgeSourceDialogFooter
