import { InfoCircleOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { RowFlex } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { Button, Space, Switch, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const JoplinSettings: FC = () => {
  const [joplinToken, setJoplinToken] = usePreference('data.integration.joplin.token')
  const [joplinUrl, setJoplinUrl] = usePreference('data.integration.joplin.url')
  const [joplinExportReasoning, setJoplinExportReasoning] = usePreference('data.integration.joplin.export_reasoning')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const { openMinapp } = useMinappPopup()

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

  const handleJoplinHelpClick = () => {
    openMinapp({
      id: 'joplin-help',
      name: 'Joplin Help',
      url: 'https://joplinapp.org/help/apps/clipper'
    })
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
        <RowFlex className="items-center" style={{ width: 315 }}>
          <Input
            type="text"
            value={joplinUrl || ''}
            onChange={handleJoplinUrlChange}
            onBlur={handleJoplinUrlBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.joplin.url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.joplin.token')}</span>
          <Tooltip title={t('settings.data.joplin.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleJoplinHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <RowFlex className="items-center" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={joplinToken || ''}
              onChange={handleJoplinTokenChange}
              onBlur={handleJoplinTokenChange}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleJoplinConnectionCheck}>{t('settings.data.joplin.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={joplinExportReasoning} onChange={handleToggleJoplinExportReasoning} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.joplin.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
