import { cn } from '@renderer/utils/style'
import type { LucideIcon } from 'lucide-react'
import { CircleHelp, Code2, Sparkles, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type AgentRuntimeModeBadgeProps = {
  type?: string | null
  className?: string
  size?: 'compact' | 'default'
}

type RuntimeModeDescriptor = {
  Icon: LucideIcon
  modeName: string
}

const RUNTIME_MODE_DESCRIPTORS: Record<string, RuntimeModeDescriptor> = {
  'claude-code': { Icon: SquareTerminal, modeName: 'Claude Code' },
  pi: { Icon: Sparkles, modeName: 'Pi' },
  dsh: { Icon: Code2, modeName: 'DSH' }
}

const UNKNOWN_RUNTIME_MODE: RuntimeModeDescriptor = {
  Icon: CircleHelp,
  modeName: 'unknown'
}

function getRuntimeModeDescriptor(type?: string | null): RuntimeModeDescriptor {
  return (type && RUNTIME_MODE_DESCRIPTORS[type]) || UNKNOWN_RUNTIME_MODE
}

export function AgentRuntimeModeBadge({ type, className, size = 'default' }: AgentRuntimeModeBadgeProps) {
  const { t } = useTranslation()
  const descriptor = getRuntimeModeDescriptor(type)
  const modeName = descriptor.modeName === 'unknown' ? t('common.unknown') : descriptor.modeName
  const label = t('agent.runtime_mode.label', { mode: modeName })
  const iconSize = size === 'compact' ? 9 : 11
  const Icon = descriptor.Icon

  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-background bg-muted text-foreground-tertiary shadow-sm',
        size === 'compact' ? 'size-3.5' : 'size-4',
        className
      )}
      data-agent-runtime-mode={type && RUNTIME_MODE_DESCRIPTORS[type] ? type : 'unknown'}
      role="img"
      title={label}>
      <Icon aria-hidden="true" size={iconSize} strokeWidth={2.25} />
    </span>
  )
}

export type { AgentRuntimeModeBadgeProps }
