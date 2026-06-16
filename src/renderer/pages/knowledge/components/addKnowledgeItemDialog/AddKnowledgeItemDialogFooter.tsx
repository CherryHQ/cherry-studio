import { Button, DialogClose } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import { KnowledgeDialogFooter } from '../KnowledgeDialogLayout'

interface AddKnowledgeItemDialogFooterProps {
  activeSource: KnowledgeItemType
  canSubmit: boolean
  errorMessage: string
  isSubmitting: boolean
  selectedDirectoryCount: number
  selectedFileCount: number
  selectedNoteCount: number
  onSubmit: () => void | Promise<void>
}

const AddKnowledgeItemDialogFooter = ({
  activeSource,
  canSubmit,
  errorMessage,
  isSubmitting,
  selectedDirectoryCount,
  selectedFileCount,
  selectedNoteCount,
  onSubmit
}: AddKnowledgeItemDialogFooterProps) => {
  const { t } = useTranslation()

  const selectionCount =
    activeSource === 'file'
      ? selectedFileCount
      : activeSource === 'directory'
        ? selectedDirectoryCount
        : activeSource === 'note'
          ? selectedNoteCount
          : 0

  const selectionText =
    activeSource === 'file'
      ? t('knowledge.data_source.add_dialog.footer.selected_files', { count: selectedFileCount })
      : activeSource === 'directory'
        ? t('knowledge.data_source.add_dialog.footer.selected_directories', { count: selectedDirectoryCount })
        : activeSource === 'note'
          ? t('knowledge.data_source.add_dialog.footer.selected_notes', { count: selectedNoteCount })
          : ''
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden">
      {errorMessage ? (
        <div
          role="alert"
          title={errorMessage}
          className="wrap-break-word max-h-16 w-full min-w-0 overflow-y-auto whitespace-pre-wrap rounded-lg border border-error-border bg-error-bg px-3 py-2 text-error-text text-xs leading-4">
          {errorMessage}
        </div>
      ) : null}

      <KnowledgeDialogFooter className="items-center sm:justify-between">
        <span className="text-foreground-muted text-xs leading-4">{selectionCount > 0 ? selectionText : ''}</span>

        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="emphasis"
            disabled={!canSubmit || isSubmitting}
            loading={isSubmitting}
            onClick={() => void onSubmit()}>
            {t('common.add')}
          </Button>
        </div>
      </KnowledgeDialogFooter>
    </div>
  )
}

export default AddKnowledgeItemDialogFooter
