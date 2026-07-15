import { REASONING_EFFORT_ORDER, type ReasoningEffort } from '@cherrystudio/provider-registry'
import { Button, Input, Switch, Tooltip } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { Check, CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Draft state for a model's user-declared reasoning controls (#16598).
 * The drawer converts it into a `RuntimeReasoning` on save; kinds map 1:1 to
 * `ReasoningControlSchema` (effort vocabulary / thinking toggle / budget
 * range). The wire dialect is NOT declared here — it follows the serving
 * provider's endpoint configuration.
 */
export interface ReasoningControlsDraft {
  effortValues: Set<ReasoningEffort>
  toggle: boolean
  budgetEnabled: boolean
  budgetMin: string
  budgetMax: string
}

export const EMPTY_REASONING_DRAFT: ReasoningControlsDraft = {
  effortValues: new Set(),
  toggle: false,
  budgetEnabled: false,
  budgetMin: '',
  budgetMax: ''
}

const EFFORT_LABEL_KEYS: Record<ReasoningEffort, string> = {
  none: 'assistants.settings.reasoning_effort.off',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  high: 'assistants.settings.reasoning_effort.high',
  xhigh: 'assistants.settings.reasoning_effort.xhigh',
  max: 'assistants.settings.reasoning_effort.max',
  auto: 'assistants.settings.reasoning_effort.auto'
}

interface ModelReasoningControlsFieldsProps {
  draft: ReasoningControlsDraft
  /** Called with the next draft on every user edit; the parent auto-saves. */
  onChange: (next: ReasoningControlsDraft) => void
  /** Commit hook for text inputs (budget min/max) — fired on blur. */
  onBlurCommit: () => void
}

export function ModelReasoningControlsFields({ draft, onChange, onBlurCommit }: ModelReasoningControlsFieldsProps) {
  const { t } = useTranslation()

  const toggleEffort = (value: ReasoningEffort) => {
    const next = new Set(draft.effortValues)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    onChange({ ...draft, effortValues: next })
  }

  return (
    <div className="space-y-3" data-testid="model-reasoning-controls">
      <div className="flex items-center gap-1 font-semibold text-foreground/90 text-sm leading-5">
        {t('settings.models.reasoning_controls.label')}
        <Tooltip content={t('settings.models.reasoning_controls.tooltip')}>
          <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-icon">
            <CircleHelp aria-hidden className="size-3" />
          </span>
        </Tooltip>
      </div>

      <div className="space-y-1.5">
        <span className="font-normal text-[13px] text-foreground-secondary leading-5">
          {t('settings.models.reasoning_controls.effort.label')}
        </span>
        <div
          className={drawerClasses.endpointChipRow}
          aria-label={t('settings.models.reasoning_controls.effort.label')}>
          {REASONING_EFFORT_ORDER.map((value) => {
            const active = draft.effortValues.has(value)
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={active ? 'secondary' : 'outline'}
                aria-pressed={active}
                className={cn('h-7 gap-1 px-2 text-xs', !active && 'text-foreground-secondary')}
                onClick={() => toggleEffort(value)}>
                {active && <Check size={12} aria-hidden />}
                {t(EFFORT_LABEL_KEYS[value])}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-normal text-[13px] text-foreground-secondary leading-5">
            {t('settings.models.reasoning_controls.toggle.label')}
          </span>
          <Tooltip content={t('settings.models.reasoning_controls.toggle.tooltip')}>
            <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-icon">
              <CircleHelp aria-hidden className="size-3" />
            </span>
          </Tooltip>
        </div>
        <Switch
          size="sm"
          aria-label={t('settings.models.reasoning_controls.toggle.label')}
          checked={draft.toggle}
          onCheckedChange={(checked) => onChange({ ...draft, toggle: checked })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-normal text-[13px] text-foreground-secondary leading-5">
              {t('settings.models.reasoning_controls.budget.label')}
            </span>
            <Tooltip content={t('settings.models.reasoning_controls.budget.tooltip')}>
              <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-icon">
                <CircleHelp aria-hidden className="size-3" />
              </span>
            </Tooltip>
          </div>
          <Switch
            size="sm"
            aria-label={t('settings.models.reasoning_controls.budget.label')}
            checked={draft.budgetEnabled}
            onCheckedChange={(checked) => onChange({ ...draft, budgetEnabled: checked })}
          />
        </div>
        {draft.budgetEnabled && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              aria-label={t('settings.models.reasoning_controls.budget.min')}
              placeholder={t('settings.models.reasoning_controls.budget.min')}
              value={draft.budgetMin}
              className={drawerClasses.input}
              onChange={(event) => onChange({ ...draft, budgetMin: event.target.value })}
              onBlur={onBlurCommit}
            />
            <span className="shrink-0 text-foreground-secondary text-xs">–</span>
            <Input
              type="number"
              min="1"
              aria-label={t('settings.models.reasoning_controls.budget.max')}
              placeholder={t('settings.models.reasoning_controls.budget.max')}
              value={draft.budgetMax}
              className={drawerClasses.input}
              onChange={(event) => onChange({ ...draft, budgetMax: event.target.value })}
              onBlur={onBlurCommit}
            />
          </div>
        )}
      </div>
    </div>
  )
}
