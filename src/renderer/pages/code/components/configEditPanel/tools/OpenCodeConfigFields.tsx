import { Input, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'

export interface OpenCodeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const triggerClass = cn(
  'flex h-9 w-full min-w-0 items-center justify-between rounded-md border bg-transparent px-3 text-sm outline-none',
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  'font-normal hover:bg-muted/30 transition-colors',
  'data-[state=open]:border-ring data-[state=open]:ring-ring/50 data-[state=open]:ring-[3px]'
)

const optionClass = cn(
  'w-full cursor-pointer rounded-sm px-2 py-1.5 text-sm text-left transition-colors',
  'hover:bg-accent hover:text-accent-foreground'
)

function SelectPopover({
  value,
  placeholder,
  onChange,
  children
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  children: (opt: string) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClass}>
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-1"
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        align="start"
        side="bottom"
        sideOffset={4}>
        {['low', 'medium', 'high'].map((opt) => (
          <button
            key={opt}
            type="button"
            className={cn(optionClass, value === opt && 'bg-primary/10 text-primary')}
            onClick={() => {
              onChange(opt)
              setOpen(false)
            }}>
            {children(opt)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('min-w-0 flex-1', className)}>
      <span className="mb-1 block text-[10px] text-muted-foreground/60">{label}</span>
      {children}
    </label>
  )
}

export const OpenCodeConfigFields: FC<OpenCodeConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()

  const env = useMemo(
    () => (config.env && typeof config.env === 'object' ? (config.env as Record<string, unknown>) : {}),
    [config.env]
  )

  const reasoning = env.OPENCODE_REASONING === 'true'
  const autoCompact = config.autoCompact === true

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const reasoningEffort = useMemo(() => {
    const v = config.reasoningEffort
    if (typeof v === 'string' && (['low', 'medium', 'high'] as readonly string[]).includes(v)) return v
    return ''
  }, [config.reasoningEffort])

  const updateEnvField = useCallback(
    (key: string, value: string) => {
      const nextEnv = { ...env }
      if (value) nextEnv[key] = value
      else delete nextEnv[key]
      onChange({ ...config, env: nextEnv })
    },
    [config, env, onChange]
  )

  const updateField = useCallback(
    (key: string, value: string | number | boolean | undefined) => {
      const next = { ...config }
      if (value !== undefined && value !== '') next[key] = value
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  const effortLabel = useCallback(
    (opt: string) =>
      t(
        opt === 'low'
          ? 'code.adv.codex.reasoning_effort_low_opt'
          : opt === 'medium'
            ? 'code.adv.codex.reasoning_effort_medium_opt'
            : 'code.adv.codex.reasoning_effort_high_opt'
      ),
    [t]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.opencode.enable_reasoning')}
          active={reasoning}
          onClick={() => updateEnvField('OPENCODE_REASONING', reasoning ? '' : 'true')}
        />
        <TogglePill
          label={t('code.adv.opencode.auto_compact')}
          active={autoCompact}
          onClick={() => updateField('autoCompact', autoCompact ? undefined : true)}
        />
      </div>

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        <div className="flex gap-3">
          <Field label={t('code.adv.opencode.max_turns_hint')}>
            <Input
              value={typeof config.maxTurns === 'number' ? String(config.maxTurns) : ''}
              onChange={(e) => {
                const v = e.target.value
                updateField('maxTurns', v ? Number(v) : undefined)
              }}
              placeholder="30"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.opencode.reasoning_effort_hint')}>
            <SelectPopover
              value={reasoningEffort}
              placeholder={t('code.adv.select_placeholder')}
              onChange={(v) => updateField('reasoningEffort', v)}>
              {effortLabel}
            </SelectPopover>
          </Field>
        </div>
        <Field label={t('code.adv.opencode.thinking_budget_hint')} className="mt-3 block w-full flex-none">
          <Input
            value={typeof config.thinkingBudgetTokens === 'number' ? String(config.thinkingBudgetTokens) : ''}
            onChange={(e) => {
              const v = e.target.value
              updateField('thinkingBudgetTokens', v ? Number(v) : undefined)
            }}
            placeholder="10000"
            type="number"
            autoComplete="off"
            className="h-9 text-sm"
          />
        </Field>
      </AdvancedConfigToggle>
    </div>
  )
}
