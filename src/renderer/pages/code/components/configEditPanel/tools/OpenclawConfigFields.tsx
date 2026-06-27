import { Input } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { FormField } from '../PanelPrimitives'
import { TogglePill } from '../TogglePill'
import { useConfigEnv } from './useConfigEnv'

export interface OpenclawConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const NUMBER_FIELDS = [
  { envKey: 'OPENCLAW_CONTEXT_WINDOW', labelKey: 'code.adv.openclaw.context_window', placeholder: '128000' },
  { envKey: 'OPENCLAW_MAX_TOKENS', labelKey: 'code.adv.openclaw.max_tokens', placeholder: '16384' }
] as const

/** OpenClaw config fields — reasoning toggle (always visible) plus context
 * window / max tokens inside the advanced collapsible. */
export const OpenclawConfigFields: FC<OpenclawConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const { env, updateField } = useConfigEnv(config, onChange)
  const [open, setOpen] = useState(false)

  const reasoningActive = env.OPENCLAW_REASONING === 'true'

  return (
    <>
      <TogglePill
        label={t('code.adv.openclaw.reasoning')}
        active={reasoningActive}
        onClick={() => updateField('OPENCLAW_REASONING', reasoningActive ? '' : 'true')}
      />

      <AdvancedConfigToggle open={open} onToggle={() => setOpen((o) => !o)}>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-2">
          {NUMBER_FIELDS.map((field) => (
            <FormField key={field.envKey} label={t(field.labelKey)}>
              <Input
                type="number"
                value={env[field.envKey] ?? ''}
                onChange={(e) => updateField(field.envKey, e.target.value)}
                placeholder={field.placeholder}
                className="font-mono"
              />
            </FormField>
          ))}
        </div>
      </AdvancedConfigToggle>
    </>
  )
}
