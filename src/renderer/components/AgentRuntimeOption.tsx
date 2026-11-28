import type { TFunction } from 'i18next'

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@cherrystudio/ui'
import { type IconComponent, PiCli } from '@cherrystudio/ui/icons'
import { ClaudeCode } from '@cherrystudio/ui/icons/providers'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'

const RUNTIME_ICONS = {
  'claude-code': ClaudeCode,
  pi: PiCli,
  local: PiCli,
  'pi-durable': PiCli
} satisfies Record<AgentType, IconComponent>

const COMPACT_RUNTIME_ICON_CLASS: Record<AgentType, string> = {
  'claude-code': 'size-6',
  pi: 'size-4',
  local: 'size-4',
  'pi-durable': 'size-4'
}

const RUNTIME_DESCRIPTION_KEYS: Record<AgentType, string> = {
  local: 'local_agents.description',
  // t('library.config.agent.field.runtime.option_description.claude_code')
  'claude-code': 'library.config.agent.field.runtime.option_description.claude_code',
  // t('library.config.agent.field.runtime.option_description.pi')
  pi: 'library.config.agent.field.runtime.option_description.pi',
  // t('library.config.agent.field.runtime.option_description.pi_durable')
  'pi-durable': 'library.config.agent.field.runtime.option_description.pi_durable'
}

const RUNTIME_CARD_CLASS_NAME = 'w-full items-center gap-2 rounded-lg px-3 py-1.5 font-normal'

function RuntimeCardBody({ runtime, t, compact = false }: { runtime: AgentType; t: TFunction; compact?: boolean }) {
  const caps = AGENT_RUNTIME_CAPABILITIES[runtime]
  const Icon = RUNTIME_ICONS[runtime]

  return (
    <>
      <ItemMedia
        variant={compact ? 'default' : 'icon'}
        className={cn(
          compact
            ? 'size-7 self-center text-foreground group-has-[[data-slot=item-description]]/item:translate-y-0 group-has-[[data-slot=item-description]]/item:self-center'
            : 'border-border-subtle bg-muted/60'
        )}>
        <Icon className={compact ? COMPACT_RUNTIME_ICON_CLASS[runtime] : undefined} />
      </ItemMedia>
      <ItemContent className={cn('min-w-0 text-left', compact && 'gap-0.5')}>
        <ItemTitle className={compact ? 'block max-w-full truncate font-medium leading-4' : undefined}>
          {t(caps.labelKey, caps.labelFallback)}
        </ItemTitle>
        <ItemDescription className={cn('text-xs', compact && 'min-w-0 text-ellipsis whitespace-nowrap leading-4')}>
          {t(RUNTIME_DESCRIPTION_KEYS[runtime])}
        </ItemDescription>
      </ItemContent>
    </>
  )
}

/** The runtime an agent already has. Not a control — there is nothing left to choose. */
export function AgentRuntimeSummary({ value, t }: { value: AgentType; t: TFunction }) {
  return (
    <Item size="sm" variant="outline" className={RUNTIME_CARD_CLASS_NAME}>
      <RuntimeCardBody runtime={value} t={t} compact />
    </Item>
  )
}
