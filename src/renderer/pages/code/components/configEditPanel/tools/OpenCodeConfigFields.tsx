import { Input, SelectDropdown } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'

export interface OpenCodeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('min-w-0 flex-1', className)}>
      <span className="mb-1 block text-[10px] text-muted-foreground/60">{label}</span>
      {children}
    </label>
  )
}

export const OpenCodeConfigFields: FC<OpenCodeConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const env = useMemo(
    () => (config.env && typeof config.env === 'object' ? (config.env as Record<string, unknown>) : {}),
    [config.env]
  )

  const reasoning = env.OPENCODE_REASONING === 'true'
  const autoCompact = config.autoCompact === true

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

  const effortItems = useMemo(
    () => (['low', 'medium', 'high'] as const).map((opt) => ({ id: opt, label: effortLabel(opt) })),
    [effortLabel]
  )

  return (
    <div className="space-y-3">
      {section !== 'advanced' && (
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
      )}

      {section !== 'basic' && (
        <>
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
              <SelectDropdown
                // FIXME: SelectDropdown list width drifts — packages/ui tailwind-merge@^2.5.5
                // can't merge Tailwind v4 `w-(--radix-popover-trigger-width)`, so PopoverContent
                // keeps both it and the base `w-72`. Fix: bump packages/ui tailwind-merge to ^3.3.1.
                items={effortItems}
                selectedId={reasoningEffort || undefined}
                onSelect={(v) => updateField('reasoningEffort', v)}
                placeholder={t('code.adv.select_placeholder')}
                renderSelected={(item) => item.label}
                renderItem={(item) => item.label}
              />
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
        </>
      )}
    </div>
  )
}
