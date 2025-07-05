import { InfoCircleOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CustomTag from '@renderer/components/CustomTag'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants, useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setQuickAssistantId } from '@renderer/store/llm'
import {
  setClickTrayToShowQuickAssistant,
  setEnableQuickAssistant,
  setReadClipboardAtStartup
} from '@renderer/store/settings'
import HomeWindow from '@renderer/windows/mini/home/HomeWindow'
import { Flex, Select, Space, Switch, Tooltip } from 'antd'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const QuickAssistantSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { enableQuickAssistant, clickTrayToShowQuickAssistant, setTray, readClipboardAtStartup } = useSettings()
  const { assistants } = useAssistants()
  const { defaultAssistant } = useDefaultAssistant()
  const { defaultModel } = useDefaultModel()
  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const dispatch = useAppDispatch()

  const useExistingAssistant = !!quickAssistantId

  const handleEnableQuickAssistant = async (enable: boolean) => {
    dispatch(setEnableQuickAssistant(enable))
    await window.api.config.set('enableQuickAssistant', enable, true)

    !enable && window.api.miniWindow.close()

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

  const handleUseExistingAssistant = async (checked: boolean) => {
    dispatch(setQuickAssistantId(checked ? defaultAssistant.id : ''))
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

  const assistantSelectorOptions = useMemo(
    () => [
      {
        value: defaultAssistant.id,
        label: (
          <Flex align="center" gap={8}>
            <ModelAvatar model={defaultAssistant.model || defaultModel} size={18} />
            <AssistantName>{defaultAssistant.name}</AssistantName>
            <Spacer />
            <CustomTag
              color="var(--color-primary)"
              size={12}
              tooltip={t('settings.quickAssistant.use_existing_assistant.select.default_tag.tooltip')}>
              {t('settings.quickAssistant.use_existing_assistant.select.default_tag')}
            </CustomTag>
          </Flex>
        ),
        name: defaultAssistant.name
      },
      ...assistants
        .filter((a) => a.id !== defaultAssistant.id)
        .map((a) => ({
          value: a.id,
          label: (
            <Flex align="center" gap={8}>
              <ModelAvatar model={a.model || defaultModel} size={18} />
              <AssistantName>{a.name}</AssistantName>
            </Flex>
          ),
          name: a.name
        }))
    ],
    [assistants, defaultAssistant.id, defaultAssistant.model, defaultAssistant.name, defaultModel, t]
  )

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
              <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {t('settings.quickAssistant.use_existing_assistant.title')}
                <Tooltip title={t('settings.quickAssistant.use_existing_assistant.tooltip')} placement="right">
                  <InfoCircleOutlined style={{ cursor: 'pointer' }} />
                </Tooltip>
              </SettingRowTitle>
              <Space>
                {useExistingAssistant && (
                  <Select
                    value={quickAssistantId || defaultAssistant.id}
                    showSearch
                    style={{ width: 300 }}
                    onChange={(value) => dispatch(setQuickAssistantId(value))}
                    placeholder={t('settings.quickAssistant.use_existing_assistant.select.placeholder')}
                    filterOption={(input, option) => (option?.name ?? '').toLowerCase().includes(input.toLowerCase())}
                    options={assistantSelectorOptions}
                  />
                )}
                <Switch checked={useExistingAssistant} onChange={handleUseExistingAssistant} />
              </Space>
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
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

const AssistantName = styled.span`
  max-width: calc(100% - 60px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Spacer = styled.div`
  flex: 1;
`

export default QuickAssistantSettings
