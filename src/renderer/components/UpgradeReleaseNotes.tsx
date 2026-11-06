import type { UpdateInfo } from 'builder-util-runtime'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button } from '@cherrystudio/ui'
import { useUpgradeReleaseNotes } from '@renderer/hooks/useUpgradeReleaseNotes'
import { localizeReleaseNotes } from '@shared/utils/releaseNotes'

import { ReleaseNotes } from './ReleaseNotes'

export function UpgradeReleaseNotes({ releaseInfo }: { releaseInfo: UpdateInfo }) {
  return <UpgradeNotesContent key={releaseInfo.version} releaseInfo={releaseInfo} />
}

function UpgradeNotesContent({ releaseInfo }: { releaseInfo: UpdateInfo }) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState<string[]>([])
  const language = i18n.resolvedLanguage ?? i18n.language
  const { supported, fromVersion, releases, status, retry } = useUpgradeReleaseNotes(releaseInfo)

  if (!supported) {
    const notes = releaseInfo.releaseNotes
    const content =
      typeof notes === 'string'
        ? localizeReleaseNotes(notes, language)
        : notes
            ?.map(({ note }) => note && localizeReleaseNotes(note, language))
            .filter(Boolean)
            .join('\n\n')
    return <ReleaseNotes content={content || t('update.noReleaseNotes')} />
  }

  const showTimeline = releases.length > 1
  const missingTarget = !releases.some(({ version }) => version === releaseInfo.version)
  return (
    <div className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere]">
      {status !== 'available' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <p role="status">{status === 'loading' ? t('update.history.loading') : t('update.history.unavailable')}</p>
          {status === 'unavailable' && (
            <Button variant="ghost" size="sm" onClick={retry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
      {missingTarget && status !== 'loading' && (
        <p className="text-sm text-muted-foreground">
          {t('update.history.targetUnavailable', { version: releaseInfo.version })}
        </p>
      )}
      {showTimeline ? (
        <div className="relative">
          <div aria-hidden="true" className="absolute start-1 top-5 bottom-5 border-s border-border" />
          <Accordion type="multiple" value={expanded} onValueChange={setExpanded}>
            {releases.map(({ version, releaseNotes }) => (
              <AccordionItem key={version} value={version} className="relative border-0 ps-6 first:border-0">
                <span
                  aria-hidden="true"
                  className="absolute start-0 top-4.5 size-2.5 rounded-full bg-muted-foreground"
                />
                <AccordionTrigger className="min-h-11 px-2 py-3 hover:bg-accent/50">v{version}</AccordionTrigger>
                <AccordionContent
                  className="px-2 pt-2 pb-5 text-foreground"
                  contentClassName="motion-reduce:animate-none">
                  <ReleaseNotes content={localizeReleaseNotes(releaseNotes, language)} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="relative py-3 ps-8 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className="absolute start-0 top-4.5 size-2.5 rounded-full border border-border bg-background"
            />
            v{fromVersion} · {t('update.history.current')}
          </p>
        </div>
      ) : (
        releases.map(({ version, releaseNotes }) => (
          <ReleaseNotes key={version} content={localizeReleaseNotes(releaseNotes, language)} />
        ))
      )}
    </div>
  )
}
