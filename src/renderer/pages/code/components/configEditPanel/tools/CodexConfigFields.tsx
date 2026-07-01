import { Input, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'

export interface CodexConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

type CodexFlag = 'goalMode' | 'remoteCompaction' | 'commonConfig' | 'disableResponseStorage'

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

const EFFORT_OPTIONS = ['low', 'medium', 'high'] as const
const VERBOSITY_OPTIONS = ['low', 'medium', 'high'] as const

function SelectPopover({
  value,
  options,
  placeholder,
  onChange
}: {
  value: string
  options: readonly string[]
  placeholder: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)

  const label = value || placeholder
  const isPlaceholder = !value

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClass}>
          <span className={cn('truncate', isPlaceholder && 'text-muted-foreground')}>{label}</span>
          <ChevronDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-1"
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        align="start"
        side="bottom"
        sideOffset={4}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={cn(optionClass, value === opt && 'bg-primary/10 text-primary')}
            onClick={() => {
              onChange(opt)
              setOpen(false)
            }}>
            {opt}
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

export const CodexConfigFields: FC<CodexConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()

  const goalMode = config.goalMode === true
  const remoteCompaction = config.remoteCompaction === true
  const commonConfig = config.commonConfig === true
  const disableResponseStorage = config.disableResponseStorage === true

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const reasoningEffort = useMemo(() => {
    const v = config.modelReasoningEffort
    if (typeof v === 'string' && (EFFORT_OPTIONS as readonly string[]).includes(v)) return v
    return ''
  }, [config.modelReasoningEffort])

  const verbosity = useMemo(() => {
    const v = config.modelVerbosity
    if (typeof v === 'string' && (VERBOSITY_OPTIONS as readonly string[]).includes(v)) return v
    return ''
  }, [config.modelVerbosity])

  const toggle = useCallback(
    (key: CodexFlag, value: boolean) => {
      const next = { ...config }
      if (value) next[key] = true
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  const updateField = useCallback(
    (key: string, value: string) => {
      const next = { ...config }
      if (value) next[key] = value
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.codex.goal_mode')}
          active={goalMode}
          onClick={() => toggle('goalMode', !goalMode)}
        />
        <TogglePill
          label={t('code.adv.codex.remote_compaction')}
          active={remoteCompaction}
          onClick={() => toggle('remoteCompaction', !remoteCompaction)}
        />
        <TogglePill
          label={t('code.adv.codex.disable_response_storage')}
          active={disableResponseStorage}
          onClick={() => toggle('disableResponseStorage', !disableResponseStorage)}
        />
        <TogglePill
          label={t('code.adv.codex.common_config')}
          active={commonConfig}
          onClick={() => toggle('commonConfig', !commonConfig)}
        />
      </div>

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        <div className="flex gap-3">
          <Field label={t('code.adv.codex.reasoning_effort_hint')}>
            <SelectPopover
              value={reasoningEffort}
              options={EFFORT_OPTIONS}
              placeholder={t('code.adv.select_placeholder')}
              onChange={(v) => updateField('modelReasoningEffort', v)}
            />
          </Field>
          <Field label={t('code.adv.codex.model_verbosity_hint')}>
            <SelectPopover
              value={verbosity}
              options={VERBOSITY_OPTIONS}
              placeholder={t('code.adv.select_placeholder')}
              onChange={(v) => updateField('modelVerbosity', v)}
            />
          </Field>
        </div>
        <div className="mt-3 flex gap-3">
          <Field label={t('code.adv.codex.context_window_hint')}>
            <Input
              value={typeof config.modelContextWindow === 'number' ? String(config.modelContextWindow) : ''}
              onChange={(e) => {
                const v = e.target.value
                const next = { ...config }
                if (v) next.modelContextWindow = Number(v)
                else delete next.modelContextWindow
                onChange(next)
              }}
              placeholder="200000"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.codex.auto_compact_limit_hint')}>
            <Input
              value={
                typeof config.modelAutoCompactTokenLimit === 'number' ? String(config.modelAutoCompactTokenLimit) : ''
              }
              onChange={(e) => {
                const v = e.target.value
                const next = { ...config }
                if (v) next.modelAutoCompactTokenLimit = Number(v)
                else delete next.modelAutoCompactTokenLimit
                onChange(next)
              }}
              placeholder="100000"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
        </div>
        <Field label={t('code.adv.codex.personality_hint')} className="mt-3 block w-full flex-none">
          <Input
            value={typeof config.personality === 'string' ? config.personality : ''}
            onChange={(e) => updateField('personality', e.target.value)}
            placeholder={t('code.adv.codex.personality_placeholder')}
            autoComplete="off"
            className="h-9 text-sm"
          />
        </Field>
      </AdvancedConfigToggle>
    </div>
  )
}
