import { Switch } from '@cherrystudio/ui'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
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
  const { clientToolsPreferred, setClientToolsPreferred } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  return (
    <SettingGroup theme={theme} variant="card">
      <SettingTitle>{t('settings.tool.websearch.client_tools_preferred.label')}</SettingTitle>
      <SettingDivider />
      <SettingRow className="min-h-8 items-center justify-between gap-3">
        <SettingHelpText className="min-w-0 flex-1">
          {t('settings.tool.websearch.client_tools_preferred.description')}
        </SettingHelpText>
        <Switch
          aria-label={t('settings.tool.websearch.client_tools_preferred.label')}
          checked={clientToolsPreferred}
          onCheckedChange={(checked) =>
            void persist(() => setClientToolsPreferred(checked), 'Failed to save the client web-tool preference')
          }
        />
      </SettingRow>
    </SettingGroup>
  )
}
