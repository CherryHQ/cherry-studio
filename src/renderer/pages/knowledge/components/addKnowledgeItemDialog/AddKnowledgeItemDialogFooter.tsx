import { useTranslation } from 'react-i18next'

import { Button, DialogClose } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import { KnowledgeDialogFooter } from '../KnowledgeDialogLayout'

interface AddKnowledgeItemDialogFooterProps {
  activeSource: KnowledgeItemType
  canSubmit: boolean
  errorMessage: string
  isSubmitting: boolean
  selectedNoteCount: number
  onSubmit: () => void | Promise<void>
}

const AddKnowledgeItemDialogFooter = ({
  activeSource,
  canSubmit,
  errorMessage,
  isSubmitting,
  selectedNoteCount,
  onSubmit
}: AddKnowledgeItemDialogFooterProps) => {
  const { t } = useTranslation()

  // Only `note` shows a running selection count; `url` has a single inline input.
  const selectionCount = activeSource === 'note' ? selectedNoteCount : 0

  const selectionText =
    activeSource === 'note'
      ? t('knowledge.data_source.add_dialog.footer.selected_notes', { count: selectedNoteCount })
      : ''
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden">
      {errorMessage ? (
        <div
          role="alert"
          title={errorMessage}
          className="max-h-16 w-full min-w-0 overflow-y-auto rounded-lg border border-error-border bg-error-subtle px-3 py-2 text-xs leading-4 wrap-break-word whitespace-pre-wrap text-error-subtle-foreground">
          {errorMessage}
        </div>
      ) : null}

      <KnowledgeDialogFooter className="items-center sm:justify-between">
        <span className="text-xs leading-4 text-foreground-tertiary">{selectionCount > 0 ? selectionText : ''}</span>

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
