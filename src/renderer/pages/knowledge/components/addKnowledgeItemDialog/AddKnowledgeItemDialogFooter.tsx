import { Button, DialogClose } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

interface AddKnowledgeItemDialogFooterProps {
  activeSource: KnowledgeItemType
  canSubmit: boolean
  errorMessage: string
  isSubmitting: boolean
  selectedDirectoryCount: number
  selectedFileCount: number
  onSubmit: () => void | Promise<void>
}

const AddKnowledgeItemDialogFooter = ({
  activeSource,
  canSubmit,
  errorMessage,
  isSubmitting,
  selectedDirectoryCount,
  selectedFileCount,
  onSubmit
}: AddKnowledgeItemDialogFooterProps) => {
  const { t } = useTranslation()

  const selectionCount =
    activeSource === 'file' ? selectedFileCount : activeSource === 'directory' ? selectedDirectoryCount : 0

  const selectionText =
    activeSource === 'file'
      ? t('knowledge.data_source.add_dialog.footer.selected_files', { count: selectedFileCount })
      : activeSource === 'directory'
        ? t('knowledge.data_source.add_dialog.footer.selected_directories', { count: selectedDirectoryCount })
        : ''
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 overflow-hidden border-border/15 border-t px-4 py-2.5">
      {errorMessage ? (
        <div
          role="alert"
          title={errorMessage}
          className="wrap-break-word max-h-16 w-full min-w-0 overflow-y-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-accent/30 px-2 py-1 text-destructive text-xs leading-4">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground/30 text-xs leading-4">{selectionCount > 0 ? selectionText : ''}</span>

        <div className="flex gap-1.5">
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-6 min-h-6 rounded-md px-2.5 text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canSubmit || isSubmitting}
            loading={isSubmitting}
            onClick={() => void onSubmit()}
            className="h-6 min-h-6 rounded-md bg-primary px-2.5 text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-40">
            {t('common.add')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AddKnowledgeItemDialogFooter
