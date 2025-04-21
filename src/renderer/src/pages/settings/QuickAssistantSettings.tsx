import { InfoCircleOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import {
  setClickTrayToShowQuickAssistant,
  setEnableQuickAssistant,
  setReadClipboardAtStartup
} from '@renderer/store/settings'
import HomeWindow from '@renderer/windows/mini/home/HomeWindow'
import { Switch, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const QuickAssistantSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { enableQuickAssistant, clickTrayToShowQuickAssistant, setTray, readClipboardAtStartup } = useSettings()
  const dispatch = useAppDispatch()

  const handleEnableQuickAssistant = async (enable: boolean) => {
    dispatch(setEnableQuickAssistant(enable))
    await window.api.config.set('enableQuickAssistant', enable)
    window.api.restartTray()
    const disable = !enable
    disable && window.api.miniWindow.close()

    if (enable && !clickTrayToShowQuickAssistant) {
      window.message.info({
        content: t('settings.quickAssistant.use_shortcut_to_show'),
        duration: 4,
        icon: <InfoCircleOutlined />,
        key: 'quick-assistant-info'
      })
    }

    if (enable && clickTrayToShowQuickAssistant) {
      setTray(true)
    }
  }

  const handleClickTrayToShowQuickAssistant = async (checked: boolean) => {
    dispatch(setClickTrayToShowQuickAssistant(checked))
    await window.api.config.set('clickTrayToShowQuickAssistant', checked)
    checked && setTray(true)
  }

  const handleClickReadClipboardAtStartup = async (checked: boolean) => {
    dispatch(setReadClipboardAtStartup(checked))
    await window.api.config.set('readClipboardAtStartup', checked)
    window.api.miniWindow.close()
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.quickAssistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.quickAssistant.enable_quick_assistant')}</span>
            <Tooltip title={t('settings.quickAssistant.use_shortcut_to_show')} placement="right">
              <InfoCircleOutlined style={{ cursor: 'pointer' }} />
            </Tooltip>
          </SettingRowTitle>
          <Switch checked={enableQuickAssistant} onChange={handleEnableQuickAssistant} />
        </SettingRow>
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
          </>
        )}
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.read_clipboard_at_startup')}</SettingRowTitle>
              <Switch checked={readClipboardAtStartup} onChange={handleClickReadClipboardAtStartup} />
            </SettingRow>
          </>
        )}
      </SettingGroup>
      {enableQuickAssistant && (
        <AssistantContainer>
          <HomeWindow />
        </AssistantContainer>
      )}
    </SettingContainer>
  )
}

const AssistantContainer = styled.div`
  width: 100%;
  height: 460px;
  background-color: var(--color-background);
  border-radius: 10px;
  border: 0.5px solid var(--color-border);
  margin: 0 auto;
  overflow: hidden;
`

export default QuickAssistantSettings
