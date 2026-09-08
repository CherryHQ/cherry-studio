import { InfoTooltip, Switch } from '@cherrystudio/ui'
import { SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchPersist } from '../hooks/useWebSearchPersist'

/**
 * Which side serves web tools when both are available. It governs every capability section, so it
 * gets its own group instead of hiding under one section's advanced settings — placed last, since
 * the per-capability provider setup is what people come here to configure.
 */
export const ToolSourceSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { modelToolsPreferred, setModelToolsPreferred } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  return (
    <SettingGroup theme={theme} variant="card">
      <SettingTitle className="gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {t('settings.tool.websearch.model_tools_preferred.label')}
          <InfoTooltip
            content={t('settings.tool.websearch.model_tools_preferred.description')}
            placement="right"
            iconProps={{ className: 'shrink-0 cursor-pointer' }}
          />
        </div>
        <Switch
          aria-label={t('settings.tool.websearch.model_tools_preferred.label')}
          checked={modelToolsPreferred}
          onCheckedChange={(checked) =>
            void persist(() => setModelToolsPreferred(checked), 'Failed to save the model web-tool preference')
          }
        />
      </SettingTitle>
    </SettingGroup>
  )
}
