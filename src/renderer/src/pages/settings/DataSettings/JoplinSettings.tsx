import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setJoplinExportReasoning, setJoplinToken, setJoplinUrl } from '@renderer/store/settings'
import { Button, Switch, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { Eye, EyeOff } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const JoplinSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { openMinapp } = useMinappPopup()
  const [showToken, setShowToken] = useState(false)

  const joplinToken = useSelector((state: RootState) => state.settings.joplinToken)
  const joplinUrl = useSelector((state: RootState) => state.settings.joplinUrl)
  const joplinExportReasoning = useSelector((state: RootState) => state.settings.joplinExportReasoning)

  const toggleToken = () => {
    setShowToken(!showToken)
  }

  const handleJoplinTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setJoplinToken(e.target.value))
  }

  const handleJoplinUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setJoplinUrl(e.target.value))
  }

  const handleJoplinUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    // 确保URL以/结尾，但只在失去焦点时执行
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      dispatch(setJoplinUrl(url))
    }
  }

  const handleJoplinConnectionCheck = async () => {
    try {
      if (!joplinToken) {
        window.message.error(t('settings.data.joplin.check.empty_token'))
        return
      }
      if (!joplinUrl) {
        window.message.error(t('settings.data.joplin.check.empty_url'))
        return
      }

      const response = await fetch(`${joplinUrl}notes?limit=1&token=${joplinToken}`)

      const data = await response.json()

      if (!response.ok || data?.error) {
        window.message.error(t('settings.data.joplin.check.fail'))
        return
      }

      window.message.success(t('settings.data.joplin.check.success'))
    } catch (e) {
      window.message.error(t('settings.data.joplin.check.fail'))
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
    dispatch(setJoplinExportReasoning(checked))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.joplin.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={joplinUrl || ''}
            onChange={handleJoplinUrlChange}
            onBlur={handleJoplinUrlBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.joplin.url_placeholder')}
          />
        </HStack>
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
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <ApiKeyContainer>
            <Input
              type={showToken ? 'text' : 'password'}
              value={joplinToken || ''}
              onChange={handleJoplinTokenChange}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <EyeButton onClick={toggleToken}>{showToken ? <Eye size={16} /> : <EyeOff size={16} />}</EyeButton>
          </ApiKeyContainer>
          <Button onClick={handleJoplinConnectionCheck}>{t('settings.data.joplin.check.button')}</Button>
        </HStack>
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

export default JoplinSettings
