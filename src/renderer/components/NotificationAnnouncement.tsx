import type { NotificationTarget } from '@shared/data/types/notification'

import { notificationPreview } from './notificationPresentation'

export default function NotificationAnnouncement({
  id,
  announcement,
  expanded
}: {
  id: string
  announcement: Extract<NotificationTarget, { kind: 'announcement' }>
  expanded: boolean
}) {
  return (
    <span
      id={`notification-${id}`}
      className={
        expanded
          ? 'block whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground'
          : 'block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground'
      }>
      {expanded ? announcement.content : notificationPreview(announcement.content)}
    </span>
  )
}
