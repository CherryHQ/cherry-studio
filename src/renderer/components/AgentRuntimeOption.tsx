import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { TFunction } from 'i18next'
import { Check, Sparkles, Zap } from 'lucide-react'

/**
 * Shared presentation for the agent runtimes.
 *
 * The runtime is picked once and never again, so both surfaces render the same card: the create
 * wizard makes them selectable, the editor shows the chosen one as a plain summary. Keeping them
 * here means the two never drift into looking like different decisions.
 */

const RUNTIME_ICONS: Record<AgentType, typeof Sparkles> = {
  'claude-code': Sparkles,
  pi: Zap
}

const RUNTIME_DESCRIPTION_KEYS: Record<AgentType, string> = {
  // t('library.config.agent.field.runtime.option_description.claude_code')
  'claude-code': 'library.config.agent.field.runtime.option_description.claude_code',
  // t('library.config.agent.field.runtime.option_description.pi')
  pi: 'library.config.agent.field.runtime.option_description.pi'
}

const RUNTIMES = Object.keys(AGENT_RUNTIME_CAPABILITIES) as AgentType[]

function RuntimeCardBody({ runtime, t }: { runtime: AgentType; t: TFunction }) {
  const caps = AGENT_RUNTIME_CAPABILITIES[runtime]
  const Icon = RUNTIME_ICONS[runtime]

  return (
    <>
      <ItemMedia variant="icon" className="border-border-subtle bg-muted/60">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0 text-left">
        <ItemTitle>{t(caps.labelKey, caps.labelFallback)}</ItemTitle>
        <ItemDescription className="text-xs">{t(RUNTIME_DESCRIPTION_KEYS[runtime])}</ItemDescription>
      </ItemContent>
    </>
  )
}

export function AgentRuntimeTiles({
  value,
  onValueChange,
  ariaLabel,
  t
}: {
  value: AgentType
  onValueChange: (value: AgentType) => void
  ariaLabel: string
  t: TFunction
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-2 gap-2">
      {RUNTIMES.map((runtime) => {
        const selected = runtime === value
        return (
          <Item
            key={runtime}
            asChild
            size="sm"
            variant="outline"
            className={cn(
              'w-full cursor-pointer rounded-xl hover:bg-accent/50',
              selected && 'border-primary bg-accent/50'
            )}>
            <button type="button" role="radio" aria-checked={selected} onClick={() => onValueChange(runtime)}>
              <RuntimeCardBody runtime={runtime} t={t} />
              <ItemActions>{selected ? <Check className="size-4 text-primary" /> : null}</ItemActions>
            </button>
          </Item>
        )
      })}
    </div>
  )
}

/** The runtime an agent already has. Not a control — there is nothing left to choose. */
export function AgentRuntimeSummary({ value, t }: { value: AgentType; t: TFunction }) {
  return (
    <Item size="sm" variant="muted" className="w-full rounded-xl">
      <RuntimeCardBody runtime={value} t={t} />
    </Item>
  )
}
