import { VStack } from '@cherrystudio/ui'
import { NotebookPen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NoteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <VStack className="min-h-0 min-w-0 flex-1" gap={3}>
      <p className="text-foreground-muted text-xs leading-4">
        {t('knowledge.data_source.add_dialog.note.description')}
      </p>

      <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-border-muted border-dashed p-4 text-center text-foreground-muted">
        {/* TODO(knowledge): Replace this placeholder with the real note picker once note data source APIs are wired up. */}
        <VStack className="min-w-0" align="center" gap={2}>
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-muted">
            <NotebookPen className="size-4" />
          </div>
          <VStack gap={1} className="min-w-0">
            <p className="text-foreground text-sm leading-5">
              {t('knowledge.data_source.add_dialog.note.empty_title')}
            </p>
            <p className="max-w-60 text-xs leading-5">{t('knowledge.data_source.add_dialog.note.empty_description')}</p>
          </VStack>
        </VStack>
      </div>
    </VStack>
  )
}

export default NoteSourceContent
