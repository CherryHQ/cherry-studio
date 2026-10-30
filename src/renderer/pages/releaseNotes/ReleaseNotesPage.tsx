import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  PageHeader,
  Scrollbar,
  Spinner
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ReleaseNotes } from '@renderer/components/ReleaseNotes'
import { ipcApi } from '@renderer/ipc'
import type { ReleaseNotesEntry } from '@shared/utils/releaseNotes'
import { localizeReleaseNotes, mergeReleaseHistory } from '@shared/utils/releaseNotes'

const logger = loggerService.withContext('ReleaseNotesPage')

export default function ReleaseNotesPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [bundledReleases, setBundledReleases] = useState<ReleaseNotesEntry[]>([])
  const [remoteReleases, setRemoteReleases] = useState<ReleaseNotesEntry[]>([])
  const [localSettled, setLocalSettled] = useState(false)
  const [expandedVersions, setExpandedVersions] = useState<string[]>([])
  const releases = mergeReleaseHistory(remoteReleases, bundledReleases)
  const newestVersion = releases[0]?.version

  useEffect(() => {
    if (newestVersion) setExpandedVersions([newestVersion])
  }, [newestVersion])

  useEffect(() => {
    let active = true

    void ipcApi
      .request('app.updater.bundled_release_notes.get')
      .then((info) => {
        if (active) setBundledReleases(info.releases)
      })
      .catch((error) => logger.warn('Failed to read bundled release history', error as Error))
      .finally(() => {
        if (active) setLocalSettled(true)
      })

    void ipcApi
      .request('app.updater.release_notes.get')
      .then((history) => {
        if (active && history) setRemoteReleases(history)
      })
      .catch((error) => logger.warn('Failed to fetch release history', error as Error))

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        bordered
        className="mb-0"
        title={t('settings.about.releases.title')}
        action={newestVersion && <span className="text-foreground-tertiary text-xs">v{newestVersion}</span>}
      />
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden">
        <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-6">
          {!newestVersion &&
            (localSettled ? <p role="alert">{t('common.error')}</p> : <Spinner text={t('common.loading')} />)}
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
