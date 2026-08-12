import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, PageHeader, Scrollbar } from '@cherrystudio/ui'
import { ReleaseNotes } from '@renderer/components/ReleaseNotes'
import { localizeReleaseNotes, mergeReleaseNotes } from '@shared/utils/releaseNotes'
import { useTranslation } from 'react-i18next'

export default function ReleaseNotesPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const releases = mergeReleaseNotes(
    { releaseNotes: __APP_RELEASE_NOTES__, version: __APP_RELEASE_VERSION__ },
    __APP_RELEASE_HISTORY__
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        bordered
        className="mb-0"
        title={t('settings.about.releases.title')}
        action={<span className="text-foreground-tertiary text-xs">v{__APP_RELEASE_VERSION__}</span>}
      />
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden">
        <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-6">
          <Accordion type="multiple" defaultValue={[__APP_RELEASE_VERSION__]} className="min-w-0">
            {releases.map(({ releaseNotes, version }) => (
              <AccordionItem key={version} value={version} className="min-w-0 border-border-subtle">
                <AccordionTrigger className="min-w-0 py-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">v{version}</span>
                </AccordionTrigger>
                <AccordionContent className="min-w-0 overflow-hidden pb-5">
                  <ReleaseNotes
                    className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                    content={localizeReleaseNotes(releaseNotes, language)}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </main>
      </Scrollbar>
    </div>
  )
}
