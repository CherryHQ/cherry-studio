import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InputNumber, Switch } from '@cherrystudio/ui'
import type { AgentFormState } from '@shared/ai/agentForm'
import {
  MAX_HEARTBEAT_INTERVAL_MINUTES,
  MAX_HEARTBEAT_TIMEOUT_MINUTES,
  MIN_HEARTBEAT_INTERVAL_MINUTES
} from '@shared/ai/agentHeartbeat'

type HeartbeatValue = Pick<AgentFormState, 'heartbeatEnabled' | 'heartbeatInterval' | 'heartbeatTimeoutMinutes'>

type HeartbeatCardProps = {
  value: HeartbeatValue
  onChange: (patch: Partial<HeartbeatValue>) => void
  /** Replaces the default description, e.g. where the heartbeat tasks cannot be edited yet. */
  description?: string
  /** Extra rows at the bottom of the card, such as the heartbeat tasks. */
  children?: ReactNode
}

/** Heartbeat switch card; when on, it reveals the interval and maximum run time in minutes. */
export function HeartbeatCard({ value, onChange, description, children }: HeartbeatCardProps) {
  const { t } = useTranslation()
  const title = t('library.config.agent.field.heartbeat_enabled.label')
  const rows = [
    {
      key: 'heartbeatInterval',
      label: t('library.config.agent.field.heartbeat_interval.label'),
      min: MIN_HEARTBEAT_INTERVAL_MINUTES,
      max: MAX_HEARTBEAT_INTERVAL_MINUTES
    },
    {
      key: 'heartbeatTimeoutMinutes',
      label: t('agent.tasks.timeout.label'),
      min: 1,
      max: MAX_HEARTBEAT_TIMEOUT_MINUTES
    }
  ] as const

  return (
    <div className="flex flex-col rounded-xl border border-border-subtle px-3">
      <div className="flex min-h-14 items-center justify-between gap-3 py-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium text-foreground text-sm leading-none">{title}</span>
          <span className="text-muted-foreground text-xs">
            {description ?? t('library.config.agent.field.heartbeat_enabled.description')}
          </span>
        </div>
        <Switch
          size="sm"
          aria-label={title}
          checked={value.heartbeatEnabled}
          onCheckedChange={(heartbeatEnabled) => onChange({ heartbeatEnabled })}
        />
      </div>
      {value.heartbeatEnabled
        ? rows.map((row) => (
            <div key={row.key} className="flex h-11 items-center justify-between gap-3 text-sm">
              <span className="text-foreground">{row.label}</span>
              <span className="flex items-center gap-2 text-muted-foreground text-xs">
                <InputNumber
                  aria-label={row.label}
                  min={row.min}
                  max={row.max}
                  step={1}
                  value={value[row.key]}
                  // Emptying the field is how you retype it, not how you turn the heartbeat off.
                  onBlur={(next) => {
                    if (next !== null) onChange({ [row.key]: next })
                  }}
                  className="h-8 w-20 text-right"
                />
                {t('agent.tasks.intervalUnit')}
              </span>
            </div>
          ))
        : null}
      {children}
    </div>
  )
}
