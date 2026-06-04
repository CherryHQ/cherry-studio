import { NotebookPen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NoteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <p className="text-foreground-muted text-xs leading-4">
        {t('knowledge.data_source.add_dialog.note.description')}
      </p>

      <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-border-muted border-dashed p-4 text-center text-foreground-muted">
        {/* TODO(knowledge): Replace this placeholder with the real note picker once note data source APIs are wired up. */}
        <div className="flex min-w-0 flex-col items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-muted">
            <NotebookPen className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-foreground text-sm leading-5">
              {t('knowledge.data_source.add_dialog.note.empty_title')}
            </p>
            <p className="max-w-60 text-xs leading-5">{t('knowledge.data_source.add_dialog.note.empty_description')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NoteSourceContent
