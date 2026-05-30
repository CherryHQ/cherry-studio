import { Button, InfoTooltip, Input, RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { formatErrorMessage } from '@renderer/utils/error'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('YuqueSettings')

const isYuqueRepoResponse = (value: unknown): value is { data: { id: string | number } } => {
  if (!value || typeof value !== 'object') return false
  const data = (value as { data?: unknown }).data
  return Boolean(data && typeof data === 'object' && 'id' in data)
}

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [yuqueToken, setYuqueToken] = usePreference('data.integration.yuque.token')
  const [yuqueUrl, setYuqueUrl] = usePreference('data.integration.yuque.url')
  const [, setYuqueRepoId] = usePreference('data.integration.yuque.repo_id')

  const handleYuqueTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setYuqueToken(e.target.value)
  }

  const handleYuqueRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setYuqueUrl(e.target.value)
  }

  const handleYuqueConnectionCheck = async () => {
    if (!yuqueToken) {
      window.toast.error(t('settings.data.yuque.check.empty_token'))
      return
    }
    if (!yuqueUrl) {
      window.toast.error(t('settings.data.yuque.check.empty_repo_url'))
      return
    }

    try {
      const response = await fetch('https://www.yuque.com/api/v2/hello', {
        headers: {
          'X-Auth-Token': yuqueToken
        }
      })

      if (!response.ok) {
        window.toast.error(t('settings.data.yuque.check.fail'))
        return
      }
      const yuqueSlug = yuqueUrl.replace('https://www.yuque.com/', '')
      const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
        headers: {
          'X-Auth-Token': yuqueToken
        }
      })
      if (!repoIDResponse.ok) {
        window.toast.error(t('settings.data.yuque.check.fail'))
        return
      }
      const data = (await repoIDResponse.json()) as unknown
      if (!isYuqueRepoResponse(data)) {
        logger.error('Invalid Yuque repo response')
        window.toast.error(t('settings.data.yuque.check.fail'))
        return
      }
      await setYuqueRepoId(String(data.data.id))
      window.toast.success(t('settings.data.yuque.check.success'))
    } catch (error) {
      logger.error('Failed to check Yuque connection', error as Error)
      window.toast.error(formatErrorMessage(error) || t('settings.data.yuque.check.fail'))
    }
  }

  const handleYuqueHelpClick = () => {
    void window.api.openWebsite('https://www.yuque.com/settings/tokens')
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.yuque.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.yuque.repo_url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-1.25">
          <Input
            type="text"
            value={yuqueUrl || ''}
            onChange={handleYuqueRepoUrlChange}
            placeholder={t('settings.data.yuque.repo_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.yuque.token')}
          <InfoTooltip
            content={t('settings.data.yuque.help')}
            placement="left"
            iconProps={{
              className: 'text-text-2 cursor-pointer ml-1'
            }}
            onClick={handleYuqueHelpClick}
          />
        </SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-1.25">
          <RowFlex className="w-full items-center gap-1.25">
            <Input
              type="password"
              value={yuqueToken || ''}
              onChange={handleYuqueTokenChange}
              onBlur={handleYuqueTokenChange}
              placeholder={t('settings.data.yuque.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleYuqueConnectionCheck} variant="outline" className="h-9 shrink-0">
              {t('settings.data.yuque.check.button')}
            </Button>
          </RowFlex>
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default YuqueSettings
