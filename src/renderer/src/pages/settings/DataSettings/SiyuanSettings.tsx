import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setSiyuanApiUrl, setSiyuanBoxId, setSiyuanRootPath, setSiyuanToken } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { Eye, EyeOff } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const SiyuanSettings: FC = () => {
  const { openMinapp } = useMinappPopup()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const [showToken, setShowToken] = useState(false)

  const siyuanApiUrl = useSelector((state: RootState) => state.settings.siyuanApiUrl)
  const siyuanToken = useSelector((state: RootState) => state.settings.siyuanToken)
  const siyuanBoxId = useSelector((state: RootState) => state.settings.siyuanBoxId)
  const siyuanRootPath = useSelector((state: RootState) => state.settings.siyuanRootPath)

  const toggleToken = () => {
    setShowToken(!showToken)
  }

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
        window.message.error(t('settings.data.siyuan.check.empty_config'))
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
        window.message.error(t('settings.data.siyuan.check.fail'))
        return
      }

      const data = await response.json()
      if (data.code !== 0) {
        window.message.error(t('settings.data.siyuan.check.fail'))
        return
      }

      window.message.success(t('settings.data.siyuan.check.success'))
    } catch (error) {
      console.error('Check Siyuan connection failed:', error)
      window.message.error(t('settings.data.siyuan.check.error'))
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.siyuan.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.api_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleApiUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.siyuan.token')}</span>
          <Tooltip title={t('settings.data.siyuan.token.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleSiyuanHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <ApiKeyContainer>
            <Input
              type={showToken ? 'text' : 'password'}
              value={siyuanToken || ''}
              onChange={handleTokenChange}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <EyeButton onClick={toggleToken}>{showToken ? <Eye size={16} /> : <EyeOff size={16} />}</EyeButton>
          </ApiKeyContainer>
          <Button onClick={handleCheckConnection}>{t('settings.data.siyuan.check.button')}</Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleBoxIdChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleRootPathChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

const ApiKeyContainer = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  flex: 1;
  width: 100%;

  .ant-input {
    padding-right: 30px;
  }
`

const EyeButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 2px;
  transition: all 0.2s ease;
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-mute);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary-outline);
  }
`

export default SiyuanSettings
