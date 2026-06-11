import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

export type SessionLabelProps = {
  session?: AgentSessionEntity
  className?: string
}

export const SessionLabel = ({ session, className }: SessionLabelProps) => {
  const displayName = session?.name ?? session?.id

  return <span className={cn('truncate text-(--color-foreground) text-sm', className)}>{displayName}</span>
}
