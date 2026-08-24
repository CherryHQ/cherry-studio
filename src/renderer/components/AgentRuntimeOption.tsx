import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Label,
  RadioGroup,
  RadioGroupItem
} from '@cherrystudio/ui'
import { PiCli } from '@cherrystudio/ui/icons'
import { Deepseek } from '@cherrystudio/ui/icons/providers'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { TFunction } from 'i18next'
import { Check, Sparkles } from 'lucide-react'
import { type ElementType, useId } from 'react'

/**
 * Shared presentation for the agent runtimes.
 *
 * The runtime is picked once and never again, so both surfaces render the same card: the create
 * wizard makes them selectable, the editor shows the chosen one as a plain summary. Keeping them
 * here means the two never drift into looking like different decisions.
 */

const RUNTIME_ICONS = {
  'claude-code': Sparkles,
  pi: PiCli,
  dsh: Deepseek
} satisfies Record<AgentType, ElementType>

const RUNTIME_DESCRIPTION_KEYS: Record<AgentType, string> = {
  // t('library.config.agent.field.runtime.option_description.claude_code')
  'claude-code': 'library.config.agent.field.runtime.option_description.claude_code',
  // t('library.config.agent.field.runtime.option_description.pi')
  pi: 'library.config.agent.field.runtime.option_description.pi',
  // t('library.config.agent.field.runtime.option_description.dsh')
  dsh: 'library.config.agent.field.runtime.option_description.dsh'
}

const RUNTIMES = Object.keys(AGENT_RUNTIME_CAPABILITIES) as AgentType[]

function RuntimeCardBody({ runtime, t, compact = false }: { runtime: AgentType; t: TFunction; compact?: boolean }) {
  const caps = AGENT_RUNTIME_CAPABILITIES[runtime]
  const Icon = RUNTIME_ICONS[runtime]

  return (
    <>
      <ItemMedia
        variant={compact ? 'default' : 'icon'}
        className={cn(compact ? 'size-4.5 text-muted-foreground' : 'border-border-subtle bg-muted/60')}>
        <Icon className={cn(compact && 'size-4.5', runtime === 'dsh' && 'scale-150')} />
      </ItemMedia>
      <ItemContent className={cn('min-w-0 text-left', compact && 'gap-0.5')}>
        <ItemTitle className={compact ? 'block max-w-full truncate' : undefined}>
          {t(caps.labelKey, caps.labelFallback)}
        </ItemTitle>
        <ItemDescription className={cn('text-xs', compact && 'min-h-8')}>
          {t(RUNTIME_DESCRIPTION_KEYS[runtime])}
        </ItemDescription>
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
  const uid = useId()

  // Radix owns the radio semantics (roving tabindex, arrow-key navigation); the visual is a card, so
  // the radio control itself is hidden and the card carries the selected and focus states.
  return (
    <RadioGroup
      aria-label={ariaLabel}
      className="grid-cols-2 gap-2"
      value={value}
      onValueChange={(next) => onValueChange(next as AgentType)}>
      {RUNTIMES.map((runtime) => {
        const optionId = `${uid}-${runtime}`
        const selected = runtime === value
        return (
          <Item
            key={runtime}
            asChild
            size="sm"
            variant="outline"
            className={cn(
              'w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 font-normal hover:bg-accent/50',
              // Focus needs its own signal: the selected card is already `border-primary`, so
              // reusing the border would make tabbing onto it invisible.
              'has-[[data-slot=radio-group-item]:focus-visible]:bg-accent',
              'has-[[data-slot=radio-group-item]:focus-visible]:ring-1 has-[[data-slot=radio-group-item]:focus-visible]:ring-ring has-[[data-slot=radio-group-item]:focus-visible]:ring-inset',
              selected && 'border-primary bg-accent/50'
            )}>
            <Label htmlFor={optionId}>
              <RadioGroupItem id={optionId} value={runtime} className="sr-only" />
              <RuntimeCardBody runtime={runtime} t={t} compact />
              <ItemActions className="size-4 shrink-0">
                {selected ? <Check className="size-4 text-primary" /> : null}
              </ItemActions>
            </Label>
          </Item>
        )
      })}
    </RadioGroup>
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
