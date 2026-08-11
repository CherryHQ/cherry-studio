import { PageHeader, Scrollbar } from '@cherrystudio/ui'
import { ReleaseNotes } from '@renderer/components/ReleaseNotes'
import { localizeReleaseNotes } from '@shared/utils/releaseNotes'
import { useTranslation } from 'react-i18next'

export default function ReleaseNotesPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const releaseNotes = localizeReleaseNotes(__APP_RELEASE_NOTES__, language)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        bordered
        className="mb-0"
        title={t('settings.about.releases.title')}
        action={<span className="text-foreground-tertiary text-xs">v{__APP_RELEASE_VERSION__}</span>}
      />
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden">
        <main className="mx-auto w-full max-w-3xl px-6 py-6">
          <ReleaseNotes content={releaseNotes} />
        </main>
      </Scrollbar>
    </div>
  )
}
