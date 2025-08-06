import { InfoCircleOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { HStack } from '@renderer/components/Layout'
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
import { Button, Select, Switch, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const QuickAssistantSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { enableQuickAssistant, clickTrayToShowQuickAssistant, setTray, readClipboardAtStartup } = useSettings()
  const dispatch = useAppDispatch()
  const { assistants } = useAssistants()
  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const { defaultAssistant } = useDefaultAssistant()
  const { defaultModel } = useDefaultModel()

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
        <SettingGroup theme={theme}>
          <HStack alignItems="center" justifyContent="space-between">
            <HStack alignItems="center" gap={10}>
              {t('settings.models.quick_assistant_model')}
              <Tooltip title={t('selection.settings.user_modal.model.tooltip')} arrow>
                <InfoCircleOutlined style={{ cursor: 'pointer' }} />
              </Tooltip>
              <Spacer />
            </HStack>
            <HStack alignItems="center" gap={10}>
              {!quickAssistantId ? null : (
                <HStack alignItems="center">
                  <Select
                    value={quickAssistantId || defaultAssistant.id}
                    style={{ width: 300, height: 34 }}
                    onChange={(value) => dispatch(setQuickAssistantId(value))}
                    placeholder={t('settings.models.quick_assistant_selection')}>
                    <Select.Option key={defaultAssistant.id} value={defaultAssistant.id}>
                      <AssistantItem>
                        <ModelAvatar model={defaultAssistant.model || defaultModel} size={18} />
                        <AssistantName>{defaultAssistant.name}</AssistantName>
                        <Spacer />
                        <DefaultTag isCurrent={true}>{t('settings.models.quick_assistant_default_tag')}</DefaultTag>
                      </AssistantItem>
                    </Select.Option>
                    {assistants
                      .filter((a) => a.id !== defaultAssistant.id)
                      .map((a) => (
                        <Select.Option key={a.id} value={a.id}>
                          <AssistantItem>
                            <ModelAvatar model={a.model || defaultModel} size={18} />
                            <AssistantName>{a.name}</AssistantName>
                            <Spacer />
                          </AssistantItem>
                        </Select.Option>
                      ))}
                  </Select>
                </HStack>
              )}
              <HStack alignItems="center" gap={0}>
                <StyledButton
                  type={quickAssistantId ? 'primary' : 'default'}
                  onClick={() => {
                    dispatch(setQuickAssistantId(defaultAssistant.id))
                  }}
                  selected={!!quickAssistantId}>
                  {t('settings.models.use_assistant')}
                </StyledButton>
                <StyledButton
                  type={!quickAssistantId ? 'primary' : 'default'}
                  onClick={() => dispatch(setQuickAssistantId(''))}
                  selected={!quickAssistantId}>
                  {t('settings.models.use_model')}
                </StyledButton>
              </HStack>
            </HStack>
          </HStack>
        </SettingGroup>
      )}
      {enableQuickAssistant && (
        <AssistantContainer>
          <HomeWindow draggable={false} />
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

const AssistantItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 28px;
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

const DefaultTag = styled.span<{ isCurrent: boolean }>`
  color: ${(props) => (props.isCurrent ? 'var(--color-primary)' : 'var(--color-text-3)')};
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
`

const StyledButton = styled(Button)<{ selected: boolean }>`
  border-radius: ${(props) => (props.selected ? '6px' : '6px')};
  z-index: ${(props) => (props.selected ? 1 : 0)};
  min-width: 80px;

  &:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right-width: 0; // No right border for the first button when not selected
  }

  &:last-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left-width: 1px; // Ensure left border for the last button
  }

  // Override Ant Design's default hover and focus styles for a cleaner look

  &:hover,
  &:focus {
    z-index: 1;
    border-color: ${(props) => (props.selected ? 'var(--ant-primary-color)' : 'var(--ant-primary-color-hover)')};
    box-shadow: ${(props) =>
      props.selected ? '0 0 0 2px var(--ant-primary-color-outline)' : '0 0 0 2px var(--ant-primary-color-outline)'};
  }
`

export default QuickAssistantSettings
