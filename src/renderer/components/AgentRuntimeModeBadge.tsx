import type { LucideIcon } from 'lucide-react'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { type IconComponent, PiCli } from '@cherrystudio/ui/icons'
import { ClaudeCode, Deepseek } from '@cherrystudio/ui/icons/providers'
import { getAgentRuntimeModeLabel } from '@renderer/utils/agent'
import { cn } from '@renderer/utils/style'

type AgentRuntimeModeBadgeProps = {
  type?: string | null
  className?: string
  size?: 'compact' | 'default'
}

const RUNTIME_MODE_ICONS = new Map<string, IconComponent | LucideIcon>([
  ['claude-code', ClaudeCode],
  ['pi', PiCli],
  ['dsh', Deepseek]
])

export function AgentRuntimeModeBadge({ type, className, size = 'default' }: AgentRuntimeModeBadgeProps) {
  const { t } = useTranslation()
  const label = getAgentRuntimeModeLabel(type, t)
  const Icon = RUNTIME_MODE_ICONS.get(type ?? '') ?? CircleHelp

  return (
    <Badge
      aria-label={label}
      className={cn(
        'overflow-visible border-0 bg-transparent p-0 text-foreground-tertiary [&>svg]:size-full',
        size === 'compact' ? 'size-3.5' : 'size-4',
        className
      )}
      data-agent-runtime-mode={type && RUNTIME_MODE_ICONS.has(type) ? type : 'unknown'}
      role="img"
      title={label}
      variant="outline">
      <Icon
        aria-hidden="true"
        className={cn('size-full', type === 'pi' && 'scale-75', type === 'dsh' && 'scale-125')}
      />
    </Badge>
  )
}

export type { AgentRuntimeModeBadgeProps }
