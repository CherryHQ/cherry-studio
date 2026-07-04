import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'

export interface CodexConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

type CodexFlag = 'goalMode' | 'remoteCompaction' | 'commonConfig' | 'disableResponseStorage'

export const CodexConfigFields: FC<CodexConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const goalMode = config.goalMode === true
  const remoteCompaction = config.remoteCompaction === true
  const commonConfig = config.commonConfig === true
  const disableResponseStorage = config.disableResponseStorage === true

  const toggle = useCallback(
    (key: CodexFlag, value: boolean) => {
      const next = { ...config }
      if (value) next[key] = true
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  if (section === 'advanced') return null

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
    </div>
  )
}
