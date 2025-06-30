import EditableNumber from '@renderer/components/EditableNumber'
import Scrollbar from '@renderer/components/Scrollbar'
import Selector from '@renderer/components/Selector'
import { isMac, isWindows } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import {
  SendMessageShortcut,
  setAutoTranslateWithSpace,
  setEnableBackspaceDeleteModel,
  setEnableQuickPanelTriggers,
  setPasteLongTextAsFile,
  setPasteLongTextThreshold,
  setRenderInputMessageAsMarkdown,
  setShowInputEstimatedTokens,
  setShowTranslateConfirm
} from '@renderer/store/settings'
import { ThemeMode, TranslateLanguageVarious } from '@renderer/types'
import { Switch } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const SettingsTab: FC = () => {
  const { t } = useTranslation()
  const { language } = useSettings()

  const dispatch = useAppDispatch()

  const {
    showInputEstimatedTokens,
    sendMessageShortcut,
    setSendMessageShortcut,
    targetLanguage,
    setTargetLanguage,
    pasteLongTextAsFile,
    renderInputMessageAsMarkdown,
    autoTranslateWithSpace,
    pasteLongTextThreshold,
    enableQuickPanelTriggers,
    enableBackspaceDeleteModel,
    showTranslateConfirm
  } = useSettings()

  return (
    <Container className="settings-tab">
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.show_estimated_tokens')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={showInputEstimatedTokens}
            onChange={(checked) => dispatch(setShowInputEstimatedTokens(checked))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.paste_long_text_as_file')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={pasteLongTextAsFile}
            onChange={(checked) => dispatch(setPasteLongTextAsFile(checked))}
          />
        </SettingRow>
        {pasteLongTextAsFile && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitleSmall>{t('settings.messages.input.paste_long_text_threshold')}</SettingRowTitleSmall>
              <EditableNumber
                size="small"
                min={500}
                max={10000}
                step={100}
                value={pasteLongTextThreshold}
                onChange={(value) => dispatch(setPasteLongTextThreshold(value ?? 500))}
                style={{ width: 80, backgroundColor: 'transparent' }}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.markdown_rendering_input_message')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={renderInputMessageAsMarkdown}
            onChange={(checked) => dispatch(setRenderInputMessageAsMarkdown(checked))}
          />
        </SettingRow>
        <SettingDivider />
        {!language.startsWith('en') && (
          <>
            <SettingRow>
              <SettingRowTitleSmall>{t('settings.input.auto_translate_with_space')}</SettingRowTitleSmall>
              <Switch
                size="small"
                checked={autoTranslateWithSpace}
                onChange={(checked) => dispatch(setAutoTranslateWithSpace(checked))}
              />
            </SettingRow>
            <SettingDivider />
          </>
        )}
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.input.show_translate_confirm')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={showTranslateConfirm}
            onChange={(checked) => dispatch(setShowTranslateConfirm(checked))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.enable_quick_triggers')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={enableQuickPanelTriggers}
            onChange={(checked) => dispatch(setEnableQuickPanelTriggers(checked))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.enable_delete_model')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={enableBackspaceDeleteModel}
            onChange={(checked) => dispatch(setEnableBackspaceDeleteModel(checked))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.input.target_language')}</SettingRowTitleSmall>
          <Selector
            value={targetLanguage || 'english'}
            options={[
              { value: 'chinese', label: t('settings.input.target_language.chinese') },
              { value: 'chinese-traditional', label: t('settings.input.target_language.chinese-traditional') },
              { value: 'english', label: t('settings.input.target_language.english') },
              { value: 'japanese', label: t('settings.input.target_language.japanese') },
              { value: 'russian', label: t('settings.input.target_language.russian') }
            ]}
            onChange={(value) => setTargetLanguage(value as TranslateLanguageVarious)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.send_shortcuts')}</SettingRowTitleSmall>
          <Selector
            value={sendMessageShortcut}
            options={[
              { value: 'Enter', label: 'Enter' },
              { value: 'Shift+Enter', label: 'Shift + Enter' },
              { value: 'Ctrl+Enter', label: 'Ctrl + Enter' },
              { value: 'Command+Enter', label: `${isMac ? '⌘' : isWindows ? 'Win' : 'Super'} + Enter` }
            ]}
            onChange={(value) => setSendMessageShortcut(value as SendMessageShortcut)}
          />
        </SettingRow>
      </SettingGroup>
    </Container>
  )
}

const Container = styled(Scrollbar)`
  min-width: 500px;
  max-width: 60vw;
  display: flex;
  flex-direction: column;
  padding: 10px;

  .ant-tabs-nav {
    .ant-tabs-tab {
      padding: 0 20px;
    }
  }

  .ant-tabs {
    .ant-tabs-content-holder {
      padding: 0 10px;
      overflow: auto;
      min-height: 460px;
    }

    .ant-tabs-content {
      height: 100%;
    }

    .ant-tabs-tabpane {
      height: 100%;
      overflow: auto;
      padding-right: 8px;
      padding-left: 8px !important;
    }
  }
`

const SettingRowTitleSmall = styled(SettingRowTitle)`
  font-size: 13px;
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  width: 100%;
`

export default SettingsTab
