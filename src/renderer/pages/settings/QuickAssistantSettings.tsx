import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { InfoTooltip, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

const QuickAssistantSettings: FC = () => {
  const [enableQuickAssistant, setEnableQuickAssistant] = usePreference('feature.quick_assistant.enabled')
  const [clickTrayToShowQuickAssistant, setClickTrayToShowQuickAssistant] = usePreference(
    'feature.quick_assistant.click_tray_to_show'
  )
  const [, setTray] = usePreference('app.tray.enabled')
  const { t } = useTranslation()
  const { theme } = useTheme()

  const handleEnableQuickAssistant = async (enable: boolean) => {
    await setEnableQuickAssistant(enable)

    void (!enable && ipcApi.request('quick_assistant.close'))

    if (enable && !clickTrayToShowQuickAssistant) {
      toast.info({
        title: t('settings.quickAssistant.use_shortcut_to_show'),
        timeout: 4000,
        icon: <Info size={16} />
      })
    }

    if (enable && clickTrayToShowQuickAssistant) {
      void setTray(true)
    }
  }

  const handleClickTrayToShowQuickAssistant = async (checked: boolean) => {
    await setClickTrayToShowQuickAssistant(checked)
    if (checked) void setTray(true)
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.quickAssistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-quick-assistant-enable-quick-assistant" className="scroll-mt-6">
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.quickAssistant.enable_quick_assistant')}</span>
            <InfoTooltip
              content={t('settings.quickAssistant.use_shortcut_to_show')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch checked={enableQuickAssistant} onCheckedChange={handleEnableQuickAssistant} />
        </SettingRow>
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onCheckedChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
          </>
        )}
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default QuickAssistantSettings
