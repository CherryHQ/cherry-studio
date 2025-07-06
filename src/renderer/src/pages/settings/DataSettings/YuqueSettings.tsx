import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setYuqueRepoId, setYuqueToken, setYuqueUrl } from '@renderer/store/settings'
import { Button, Space, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { Eye, EyeOff } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { openMinapp } = useMinappPopup()
  const [showApiKey, setShowApiKey] = useState(false)

  const yuqueToken = useSelector((state: RootState) => state.settings.yuqueToken)
  const yuqueUrl = useSelector((state: RootState) => state.settings.yuqueUrl)

  const toggleApiKey = () => {
    setShowApiKey(!showApiKey)
  }

  const handleYuqueTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueToken(e.target.value))
  }

  const handleYuqueRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueUrl(e.target.value))
  }

  const handleYuqueConnectionCheck = async () => {
    if (!yuqueToken) {
      window.message.error(t('settings.data.yuque.check.empty_token'))
      return
    }
    if (!yuqueUrl) {
      window.message.error(t('settings.data.yuque.check.empty_url'))
      return
    }

    const response = await fetch('https://www.yuque.com/api/v2/hello', {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })

    if (!response.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const yuqueSlug = yuqueUrl.replace('https://www.yuque.com/', '')
    const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })
    if (!repoIDResponse.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const data = await repoIDResponse.json()
    dispatch(setYuqueRepoId(data.data.id))
    window.message.success(t('settings.data.yuque.check.success'))
  }

  const handleYuqueHelpClick = () => {
    openMinapp({
      id: 'yuque-help',
      name: 'Yuque Help',
      url: 'https://www.yuque.com/settings/tokens'
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.yuque.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.yuque.repo_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={yuqueUrl || ''}
            onChange={handleYuqueRepoUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.yuque.repo_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.yuque.token')}
          <Tooltip title={t('settings.data.yuque.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleYuqueHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <ApiKeyContainer>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={yuqueToken || ''}
                onChange={handleYuqueTokenChange}
                onBlur={handleYuqueTokenChange}
                placeholder={t('settings.data.yuque.token_placeholder')}
                style={{ width: '100%' }}
              />
              <EyeButton onClick={toggleApiKey}>{showApiKey ? <Eye size={16} /> : <EyeOff size={16} />}</EyeButton>
            </ApiKeyContainer>
            <Button onClick={handleYuqueConnectionCheck}>{t('settings.data.yuque.check.button')}</Button>
          </Space.Compact>
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

export default YuqueSettings
