import { OPEN_CODE_PERMISSION_MODES } from '@renderer/pages/code/cliConfig'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { ConfigSelectField } from './ConfigFieldPrimitives'
import { makeUpdateField } from './configFieldUtils'

export interface OpenCodeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

const PERMISSION_MODE_LABEL_KEYS: Record<(typeof OPEN_CODE_PERMISSION_MODES)[number], string> = {
  ask: 'code.adv.permission_modes.ask',
  deny: 'code.adv.permission_modes.deny'
}

export const OpenCodeConfigFields: FC<OpenCodeConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const env = useMemo(
    () => (config.env && typeof config.env === 'object' ? (config.env as Record<string, unknown>) : {}),
    [config.env]
  )

  const reasoning = env.OPENCODE_REASONING === 'true'
  const autoCompact = config.autoCompact === true

  const updateEnvField = useCallback(
    (key: string, value: string) => {
      const nextEnv = { ...env }
      if (value) nextEnv[key] = value
      else delete nextEnv[key]
      onChange({ ...config, env: nextEnv })
    },
    [config, env, onChange]
  )

  const updateField = useMemo(() => makeUpdateField(config, onChange), [config, onChange])

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <ConfigSelectField
        label={t('code.adv.permission_mode')}
        value={typeof config.permissionMode === 'string' ? config.permissionMode : undefined}
        unsetLabel={t('code.adv.permission_modes.default_allow_all')}
        options={OPEN_CODE_PERMISSION_MODES.map((mode) => ({
          value: mode,
          label: t(PERMISSION_MODE_LABEL_KEYS[mode])
        }))}
        onChange={(value) => updateField('permissionMode', value)}
      />
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
    </div>
  )
}
