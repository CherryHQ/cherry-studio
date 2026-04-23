import { NotebookPen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NoteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-[10px] text-muted-foreground/40 leading-4">
        {t('knowledge_v2.data_source.add_dialog.note.description')}
      </p>

      <div className="flex min-h-29.5 flex-1 items-center justify-center rounded-lg border-2 border-border/30 border-dashed bg-muted/[0.06] p-5 text-center">
        {/* TODO(knowledge-v2): Replace this placeholder with the real note picker once note data source APIs are wired up. */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/55">
            <NotebookPen className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-foreground leading-4">
              {t('knowledge_v2.data_source.add_dialog.note.empty_title')}
            </p>
            <p className="max-w-60 text-[10px] text-muted-foreground/60 leading-4">
              {t('knowledge_v2.data_source.add_dialog.note.empty_description')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NoteSourceContent
