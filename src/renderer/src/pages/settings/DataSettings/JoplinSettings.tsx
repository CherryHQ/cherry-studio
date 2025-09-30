import { InfoTooltip, RowFlex } from '@cherrystudio/ui'
import { Switch } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Space } from 'antd'
import { Input } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const JoplinSettings: FC = () => {
  const [joplinToken, setJoplinToken] = usePreference('data.integration.joplin.token')
  const [joplinUrl, setJoplinUrl] = usePreference('data.integration.joplin.url')
  const [joplinExportReasoning, setJoplinExportReasoning] = usePreference('data.integration.joplin.export_reasoning')

  const { t } = useTranslation()
  const { theme } = useTheme()

  const handleJoplinTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJoplinToken(e.target.value)
  }

  const handleJoplinUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJoplinUrl(e.target.value)
  }

  const handleJoplinUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    // 确保URL以/结尾，但只在失去焦点时执行
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      setJoplinUrl(url)
    }
  }

  const handleJoplinConnectionCheck = async () => {
    try {
      if (!joplinToken) {
        window.toast.error(t('settings.data.joplin.check.empty_token'))
        return
      }
      if (!joplinUrl) {
        window.toast.error(t('settings.data.joplin.check.empty_url'))
        return
      }

      const response = await fetch(`${joplinUrl}notes?limit=1&token=${joplinToken}`)

      const data = await response.json()

      if (!response.ok || data?.error) {
        window.toast.error(t('settings.data.joplin.check.fail'))
        return
      }

      window.toast.success(t('settings.data.joplin.check.success'))
    } catch (e) {
      window.toast.error(t('settings.data.joplin.check.fail'))
    }
  }

  const handleToggleJoplinExportReasoning = (checked: boolean) => {
    setJoplinExportReasoning(checked)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.joplin.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={joplinUrl || ''}
            onChange={handleJoplinUrlChange}
            onBlur={handleJoplinUrlBlur}
            className="w-[315px]"
            placeholder={t('settings.data.joplin.url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.joplin.token')}</span>
          <InfoTooltip
            content={t('settings.data.joplin.help')}
            placement="left"
            iconProps={{ className: 'text-text-2 cursor-pointer ml-1' }}
          />
        </SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={joplinToken || ''}
              onChange={handleJoplinTokenChange}
              onBlur={handleJoplinTokenChange}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onPress={handleJoplinConnectionCheck}>{t('settings.data.joplin.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.export_reasoning.title')}</SettingRowTitle>
        <Switch isSelected={joplinExportReasoning} onValueChange={handleToggleJoplinExportReasoning} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.joplin.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
