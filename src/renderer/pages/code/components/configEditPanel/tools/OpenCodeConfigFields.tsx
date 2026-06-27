import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { useConfigEnv } from './useConfigEnv'

export interface OpenCodeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

/** OpenCode config — a single reasoning toggle stored on the config blob env
 * and applied to `~/.config/opencode/opencode.json` by `writeOpenCode`. */
export const OpenCodeConfigFields: FC<OpenCodeConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const { env, updateField } = useConfigEnv(config, onChange)

  const reasoningActive = env.OPENCODE_REASONING === 'true'

  return (
    <div className="flex flex-wrap gap-1.5">
      <TogglePill
        label={t('code.adv.openclaw.reasoning')}
        active={reasoningActive}
        onClick={() => updateField('OPENCODE_REASONING', reasoningActive ? '' : 'true')}
      />
    </div>
  )
}
