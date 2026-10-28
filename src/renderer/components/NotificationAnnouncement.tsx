import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
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
  const { url: announcementUrl } = announcement
  return (
    <>
      <div id={`notification-${id}`} className="whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground">
        {announcement.content}
      </div>
      {announcementUrl && (
        <Button variant="outline" onClick={() => openLink(announcementUrl)}>
          {t('common.open')}
        </Button>
      )}
    </>
  )
}
