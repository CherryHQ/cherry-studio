import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, PageHeader, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ReleaseNotes } from '@renderer/components/ReleaseNotes'
import { ipcApi } from '@renderer/ipc'
import type { ReleaseNotesEntry } from '@shared/utils/releaseNotes'
import { localizeReleaseNotes, mergeReleaseHistory, mergeReleaseNotes } from '@shared/utils/releaseNotes'

const logger = loggerService.withContext('ReleaseNotesPage')

export default function ReleaseNotesPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [bundledReleases] = useState(() =>
    mergeReleaseNotes(
      { releaseNotes: __APP_RELEASE_NOTES__, version: __APP_RELEASE_VERSION__ },
      __APP_RELEASE_HISTORY__
    )
  )
  const [remoteReleases, setRemoteReleases] = useState<ReleaseNotesEntry[] | null>(null)
  const [expandedVersions, setExpandedVersions] = useState<string[]>([__APP_RELEASE_VERSION__])
  const releases = remoteReleases ? mergeReleaseHistory(remoteReleases, bundledReleases) : bundledReleases

  useEffect(() => {
    let active = true

    void ipcApi
      .request('app.updater.release_notes.get')
      .then((releaseHistory) => {
        if (!active || !releaseHistory) return

        setRemoteReleases(releaseHistory)
        setExpandedVersions([mergeReleaseHistory(releaseHistory, bundledReleases)[0].version])
      })
      .catch((error) => logger.warn('Failed to fetch release history', error as Error))

    return () => {
      active = false
    }
  }, [bundledReleases])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        bordered
        className="mb-0"
        title={t('settings.about.releases.title')}
        action={<span className="text-foreground-tertiary text-xs">v{releases[0].version}</span>}
      />
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden">
        <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-6">
          <Accordion type="multiple" value={expandedVersions} onValueChange={setExpandedVersions} className="min-w-0">
            {releases.map(({ releaseNotes, version }) => (
              <AccordionItem key={version} value={version} className="min-w-0 border-border-subtle first:border-t-0">
                <AccordionTrigger className="min-w-0 py-3 focus-visible:bg-transparent focus-visible:[&>span]:underline focus-visible:[&>span]:underline-offset-4">
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
