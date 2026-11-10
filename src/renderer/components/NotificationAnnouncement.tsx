import type { NotificationTarget } from '@shared/data/types/notification'

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
          : 'line-clamp-2 whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground'
      }>
      {announcement.content}
    </span>
  )
}
