import { loggerService } from '@logger'
import { RowFlex } from '@renderer/components/Layout'
import { Flex } from '@renderer/components/Layout'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setSiyuanApiUrl, setSiyuanBoxId, setSiyuanRootPath, setSiyuanToken } from '@renderer/store/settings'
import { Button, Space } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('SiyuanSettings')

const SiyuanSettings: FC = () => {
  const { openMinapp } = useMinappPopup()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const siyuanApiUrl = useSelector((state: RootState) => state.settings.siyuanApiUrl)
  const siyuanToken = useSelector((state: RootState) => state.settings.siyuanToken)
  const siyuanBoxId = useSelector((state: RootState) => state.settings.siyuanBoxId)
  const siyuanRootPath = useSelector((state: RootState) => state.settings.siyuanRootPath)

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSiyuanApiUrl(e.target.value))
  }

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSiyuanToken(e.target.value))
  }

  const handleBoxIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSiyuanBoxId(e.target.value))
  }

  const handleRootPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSiyuanRootPath(e.target.value))
  }

  const handleSiyuanHelpClick = () => {
    openMinapp({
      id: 'siyuan-help',
      name: 'Siyuan Help',
      url: 'https://docs.cherry-ai.com/advanced-basic/siyuan'
    })
  }

  const handleCheckConnection = async () => {
    try {
      if (!siyuanApiUrl || !siyuanToken) {
        window.toast.error(t('settings.data.siyuan.check.empty_config'))
        return
      }

      const response = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${siyuanToken}`
        }
      })

      if (!response.ok) {
        window.toast.error(t('settings.data.siyuan.check.fail'))
        return
      }

      const data = await response.json()
      if (data.code !== 0) {
        window.toast.error(t('settings.data.siyuan.check.fail'))
        return
      }

      window.toast.success(t('settings.data.siyuan.check.success'))
    } catch (error) {
      logger.error('Check Siyuan connection failed:', error as Error)
      window.toast.error(t('settings.data.siyuan.check.error'))
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.siyuan.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.api_url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleApiUrlChange}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <Flex className="items-center gap-1">
          <SettingRowTitle>{t('settings.data.siyuan.token.label')}</SettingRowTitle>
          <InfoTooltip
            content={t('settings.data.siyuan.token.help')}
            placement="left"
            onClick={handleSiyuanHelpClick}
          />
        </Flex>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={siyuanToken || ''}
              onChange={handleTokenChange}
              onBlur={handleTokenChange}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleCheckConnection}>{t('settings.data.siyuan.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleBoxIdChange}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleRootPathChange}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default SiyuanSettings
