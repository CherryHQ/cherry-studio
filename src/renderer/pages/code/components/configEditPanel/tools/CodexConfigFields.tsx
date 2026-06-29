import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'

export interface CodexConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

type CodexFlag = 'goalMode' | 'remoteCompaction' | 'commonConfig'

/** Codex config toggles stored on the config blob and applied to
 * `~/.codex/config.toml` by `writeCodex` at launch. `commonConfig` is UI-only
 * for now — merging a shared TOML snippet needs a snippet source first. */
export const CodexConfigFields: FC<CodexConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()

  const goalMode = config.goalMode === true
  const remoteCompaction = config.remoteCompaction === true
  const commonConfig = config.commonConfig === true

  const toggle = useCallback(
    (key: CodexFlag, value: boolean) => {
      const next = { ...config }
      if (value) next[key] = true
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  return (
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
        label={t('code.adv.codex.common_config')}
        active={commonConfig}
        onClick={() => toggle('commonConfig', !commonConfig)}
      />
    </div>
  )
}
