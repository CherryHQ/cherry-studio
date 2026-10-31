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
          : 'block max-h-[2lh] overflow-hidden whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground [mask-image:linear-gradient(to_bottom,black_75%,transparent)]'
      }>
      {announcement.content}
    </span>
  )
}
