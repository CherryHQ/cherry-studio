import { Input } from '@cherrystudio/ui'
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { FormField } from '../PanelPrimitives'
import { useConfigEnv } from './useConfigEnv'

export interface HermesConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  children?: ReactNode
}

const NUMBER_FIELDS = [
  { envKey: 'HERMES_CONTEXT_LENGTH', labelKey: 'code.adv.hermes.context_length', placeholder: '128000' },
  { envKey: 'HERMES_MAX_TOKENS', labelKey: 'code.adv.hermes.max_tokens', placeholder: '16384' }
] as const

/** Hermes config fields — context length / max tokens inside the advanced
 * collapsible. No always-on toggles (Hermes has none worth exposing). */
export const HermesConfigFields: FC<HermesConfigFieldsProps> = ({ config, onChange, children }) => {
  const { t } = useTranslation()
  const { env, updateField } = useConfigEnv(config, onChange)
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-4">
      <AdvancedConfigToggle open={open} onToggle={() => setOpen((o) => !o)}>
        {children}
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
    </div>
  )
}
