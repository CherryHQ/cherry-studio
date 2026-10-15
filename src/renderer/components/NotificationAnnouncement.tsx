import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Markdown, type MarkdownProps } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { NotificationTarget } from '@shared/data/types/notification'

const logger = loggerService.withContext('NotificationAnnouncement')
const openLink = (url: string) => {
  void ipcApi
    .request('system.shell.open_website', url)
    .catch((error) => logger.error('Failed to open announcement link', error as Error))
}

export default function NotificationAnnouncement({
  id,
  announcement
}: {
  id: string
  announcement: Extract<NotificationTarget, { kind: 'announcement' }>
}) {
  const { t } = useTranslation()
  const components = useMemo<MarkdownProps['components']>(
    () => ({
      a: ({ href, children }) => {
        if (!href) return <span>{children}</span>
        let url: string
        try {
          url = new URL(href, announcement.url).href
        } catch {
          return <span>{children}</span>
        }
        return (
          <a
            href={url}
            onClick={(event) => {
              event.preventDefault()
              openLink(url)
            }}>
            {children}
          </a>
        )
      }
    }),
    [announcement.url]
  )

  return (
    <>
      <Markdown id={`notification-${id}`} components={components} className="text-sm text-muted-foreground">
        {announcement.content}
      </Markdown>
      <Button variant="outline" onClick={() => openLink(announcement.url)}>
        {t('common.open_in', { name: 'GitHub' })}
      </Button>
    </>
  )
}
