import { NotebookPen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NoteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-foreground-muted text-xs leading-4">
        {t('knowledge.data_source.add_dialog.note.description')}
      </p>

      <div className="flex min-h-29.5 flex-1 items-center justify-center rounded-lg border-2 border-border-subtle border-dashed bg-background-subtle p-5 text-center">
        {/* TODO(knowledge): Replace this placeholder with the real note picker once note data source APIs are wired up. */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-muted">
            <NotebookPen className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-foreground text-sm leading-4">
              {t('knowledge.data_source.add_dialog.note.empty_title')}
            </p>
            <p className="max-w-60 text-foreground-muted text-xs leading-4">
              {t('knowledge.data_source.add_dialog.note.empty_description')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NoteSourceContent
