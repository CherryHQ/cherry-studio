import { ChevronDown, CornerDownRight, ListOrdered, SquareStop } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, RadioGroupItem, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { AGENT_BUSY_SEND_MODES, type AgentBusySendMode } from '@shared/ai/transport'

interface AgentBusySendModeSelectorProps {
  value: AgentBusySendMode
  onChange: (mode: AgentBusySendMode) => void
  disabled?: boolean
}

function modeIcon(mode: AgentBusySendMode) {
  switch (mode) {
    case 'queue':
      return <ListOrdered size={14} className="shrink-0" />
    case 'steer':
      return <CornerDownRight size={14} className="shrink-0" />
    case 'interrupt':
      return <SquareStop size={14} className="shrink-0" />
  }
}

function isAgentBusySendMode(value: string): value is AgentBusySendMode {
  return (AGENT_BUSY_SEND_MODES as readonly string[]).includes(value)
}

/**
 * Busy-time Agent composer send-mode selector (`queue` / `steer` / `interrupt`).
 * Rendered only while an Agent turn is active on runtimes advertising all three busy modes.
 */
export function AgentBusySendModeSelector({ value, onChange, disabled = false }: AgentBusySendModeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ariaLabel = t('agent.input.busy_send_mode.aria_label')
  const currentLabel = t(`agent.input.busy_send_mode.${value}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip placement="top" content={ariaLabel}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`${ariaLabel} (${currentLabel})`}
            data-ui="chat.composer.busy-send-mode"
            data-busy-send-mode={value}
            className={cn(
              'h-7 gap-1 rounded-md px-1.5 text-xs',
              value === 'interrupt'
                ? 'text-destructive hover:text-destructive focus-visible:text-destructive'
                : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground'
            )}>
            {modeIcon(value)}
            <span>{currentLabel}</span>
            <ChevronDown size={13} className="shrink-0" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 rounded-lg border-frame-border p-2.5 text-xs shadow-xl">
        <div className="mb-1.5 px-1.5 font-medium text-muted-foreground">{t('agent.input.busy_send_mode.title')}</div>
        <RadioGroup
          value={value}
          aria-label={ariaLabel}
          onValueChange={(next) => {
            if (!isAgentBusySendMode(next)) return
            onChange(next)
            setOpen(false)
          }}
          className="gap-1">
          {AGENT_BUSY_SEND_MODES.map((mode) => {
            const label = t(`agent.input.busy_send_mode.${mode}.label`)
            const description = t(`agent.input.busy_send_mode.${mode}.description`)
            const selected = value === mode
            const itemId = `agent-busy-send-mode-${mode}`

            return (
              <label
                key={mode}
                htmlFor={itemId}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60',
                  selected && 'bg-accent/80'
                )}>
                <RadioGroupItem
                  id={itemId}
                  value={mode}
                  checked={selected}
                  onChange={() => {}}
                  size="sm"
                  aria-label={label}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 font-medium',
                      mode === 'interrupt' ? 'text-destructive' : 'text-foreground'
                    )}>
                    {modeIcon(mode)}
                    <span>{label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
                </span>
              </label>
            )
          })}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}
