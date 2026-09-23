import type { LucideIcon } from 'lucide-react'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type IconComponent, PiCli } from '@cherrystudio/ui/icons'
import { ClaudeCode, Deepseek } from '@cherrystudio/ui/icons/providers'
import { cn } from '@renderer/utils/style'

type AgentRuntimeModeBadgeProps = {
  type?: string | null
  className?: string
  size?: 'compact' | 'default'
}

type RuntimeModeDescriptor = {
  Icon: IconComponent | LucideIcon
  modeName: string
}

const RUNTIME_MODE_DESCRIPTORS: Record<string, RuntimeModeDescriptor> = {
  'claude-code': { Icon: ClaudeCode, modeName: 'Claude Code' },
  pi: { Icon: PiCli, modeName: 'Pi' },
  dsh: { Icon: Deepseek, modeName: 'DSH' }
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
  const Icon = descriptor.Icon

  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-foreground-tertiary',
        size === 'compact' ? 'size-3.5' : 'size-4',
        className
      )}
      data-agent-runtime-mode={type && RUNTIME_MODE_DESCRIPTORS[type] ? type : 'unknown'}
      role="img"
      title={label}>
      <Icon
        aria-hidden="true"
        className={cn('size-full', type === 'pi' && 'scale-75', type === 'dsh' && 'scale-125')}
      />
    </span>
  )
}

export type { AgentRuntimeModeBadgeProps }
