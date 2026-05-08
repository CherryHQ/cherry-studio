import { Button, InfoTooltip, Input, RowFlex, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { formatErrorMessage } from '@renderer/utils/error'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('JoplinSettings')

const JoplinSettings: FC = () => {
  const [joplinToken, setJoplinToken] = usePreference('data.integration.joplin.token')
  const [joplinUrl, setJoplinUrl] = usePreference('data.integration.joplin.url')
  const [joplinExportReasoning, setJoplinExportReasoning] = usePreference('data.integration.joplin.export_reasoning')

  const { t } = useTranslation()
  const { theme } = useTheme()

  const handleJoplinTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setJoplinToken(e.target.value)
  }

  const { openSmartMiniApp } = useMiniAppPopup()

  const handleJoplinUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setJoplinUrl(e.target.value)
  }

  const handleJoplinUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      void setJoplinUrl(url)
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
    } catch (error) {
      logger.error('Failed to check Joplin connection', error as Error)
      window.toast.error(`${t('settings.data.joplin.check.fail')}: ${formatErrorMessage(error)}`)
    }
  }

  const handleToggleJoplinExportReasoning = (checked: boolean) => {
    void setJoplinExportReasoning(checked)
  }

  const handleJoplinHelpClick = () => {
    openSmartMiniApp({
      appId: 'joplin-help',
      name: 'Joplin Help',
      url: 'https://joplinapp.org/help/apps/clipper',
      logo: AppLogo
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.joplin.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-1.25">
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
            onClick={handleJoplinHelpClick}
          />
        </SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-1.25">
          <RowFlex className="w-full items-center gap-1.25">
            <Input
              type="password"
              value={joplinToken || ''}
              onChange={handleJoplinTokenChange}
              onBlur={handleJoplinTokenChange}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleJoplinConnectionCheck} variant="outline" className="h-9 shrink-0">
              {t('settings.data.joplin.check.button')}
            </Button>
          </RowFlex>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={joplinExportReasoning} onCheckedChange={handleToggleJoplinExportReasoning} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.joplin.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
