import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'
import { useConfigEnv } from './useConfigEnv'

export interface OpenCodeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  children?: ReactNode
}

/** OpenCode config — a single reasoning toggle stored on the config blob env
 * and applied to `~/.config/opencode/opencode.json` by `writeOpenCode`. */
export const OpenCodeConfigFields: FC<OpenCodeConfigFieldsProps> = ({ config, onChange, children }) => {
  const { t } = useTranslation()
  const { env, updateField } = useConfigEnv(config, onChange)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const reasoningActive = env.OPENCODE_REASONING === 'true'

  return (
    <div className="space-y-4">
      <TogglePill
        label={t('code.adv.openclaw.reasoning')}
        active={reasoningActive}
        onClick={() => updateField('OPENCODE_REASONING', reasoningActive ? '' : 'true')}
      />

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        {children}
      </AdvancedConfigToggle>
    </div>
  )
}
