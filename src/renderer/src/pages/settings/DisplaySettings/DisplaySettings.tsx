import { SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { updateAssistantSettings } from '@renderer/store/assistants'
import {
  DEFAULT_SIDEBAR_ICONS,
  setClickAssistantToShowTopic,
  setCustomCss,
  setShowTopicTime,
  setSidebarIcons
} from '@renderer/store/settings'
import { ThemeMode } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { Button, Checkbox, Input, Segmented, Switch } from 'antd'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import MiniAppIconsManager from './MiniAppIconsManager'
import SidebarIconsManager from './SidebarIconsManager'

const DisplaySettings: FC = () => {
  const {
    setTheme,
    theme,
    windowStyle,
    setWindowStyle,
    topicPosition,
    setTopicPosition,
    clickAssistantToShowTopic,
    showTopicTime,
    customCss,
    sidebarIcons,
    showAssistantIcon,
    setShowAssistantIcon,
    advancedMode,
    setAdvancedMode
  } = useSettings()
  const { minapps, disabled, updateMinapps, updateDisabledMinapps } = useMinapps()
  const { theme: themeMode } = useTheme()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { assistants } = useAppSelector((state) => state.assistants)

  const [visibleIcons, setVisibleIcons] = useState(sidebarIcons?.visible || DEFAULT_SIDEBAR_ICONS)
  const [disabledIcons, setDisabledIcons] = useState(sidebarIcons?.disabled || [])
  const [visibleMiniApps, setVisibleMiniApps] = useState(minapps)
  const [disabledMiniApps, setDisabledMiniApps] = useState(disabled || [])

  // 进阶模式切换函数
  const toggleAdvancedMode = async (checked: boolean) => {
    if (checked) {
      let allCheckedValue = false

      const ConfirmContent = () => {
        const [checkboxes, setCheckboxes] = useState({
          temperature: false,
          topP: false,
          context: false,
          maxTokens: false,
          reasoning: false
        })

        const allChecked = Object.values(checkboxes).every((value) => value)

        // 更新外部变量以便在确认对话框关闭后使用
        useEffect(() => {
          allCheckedValue = allChecked

          // 动态更新确认按钮的禁用状态
          const okButton = document.querySelector('.ant-modal-confirm-btns .ant-btn-primary') as HTMLButtonElement
          if (okButton) {
            okButton.disabled = !allChecked
          }
        }, [allChecked])

        const handleCheckboxChange = (key: string) => (e: any) => {
          setCheckboxes((prev) => ({ ...prev, [key]: e.target.checked }))
        }

        return (
          <div>
            {t('settings.display.advanced_mode.confirm_content')}
            <ul style={{ marginTop: 10, paddingLeft: 20 }}>
              <li>
                <Checkbox checked={checkboxes.temperature} onChange={handleCheckboxChange('temperature')}>
                  {t('settings.display.advanced_mode.temperature_warning')}
                </Checkbox>
              </li>
              <li>
                <Checkbox checked={checkboxes.topP} onChange={handleCheckboxChange('topP')}>
                  {t('settings.display.advanced_mode.top_p_warning')}
                </Checkbox>
              </li>
              <li>
                <Checkbox checked={checkboxes.context} onChange={handleCheckboxChange('context')}>
                  {t('settings.display.advanced_mode.context_warning')}
                </Checkbox>
              </li>
              <li>
                <Checkbox checked={checkboxes.maxTokens} onChange={handleCheckboxChange('maxTokens')}>
                  {t('settings.display.advanced_mode.max_tokens_warning')}
                </Checkbox>
              </li>
              <li>
                <Checkbox checked={checkboxes.reasoning} onChange={handleCheckboxChange('reasoning')}>
                  {t('settings.display.advanced_mode.reasoning_warning')}
                </Checkbox>
              </li>
            </ul>
            <div style={{ marginTop: 15, color: '#ff4d4f' }}>
              {!allChecked && t('settings.display.advanced_mode.check_all_warning')}
            </div>
          </div>
        )
      }

      const confirmed = await modalConfirm({
        title: t('settings.display.advanced_mode.confirm'),
        icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
        content: <ConfirmContent />,
        okText: t('settings.display.advanced_mode.confirm_button'),
        cancelText: t('common.cancel'),
        okButtonProps: {
          danger: true
        }
      })

      // 检查是否确认并且所有复选框都被勾选
      if (!confirmed || !allCheckedValue) return
    } else {
      // 关闭进阶模式的确认对话框
      const confirmed = await modalConfirm({
        title: t('settings.display.advanced_mode.disable_confirm'),
        icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
        content: t('settings.display.advanced_mode.disable_confirm_content'),
        okText: t('settings.display.advanced_mode.disable_confirm_button'),
        cancelText: t('common.cancel'),
        // 确保确认按钮始终可用
        okButtonProps: {
          danger: true,
          disabled: false // 明确设置为不禁用
        }
      })
      if (!confirmed) return

      // 当关闭进阶模式时，设置所有助手的无限上下文为false和上下文数量为5
      try {
        // 更新每个助手的设置
        for (const assistant of assistants) {
          dispatch(
            updateAssistantSettings({
              assistantId: assistant.id,
              settings: {
                enableInfiniteContext: false,
                contextCount: 5
              }
            })
          )
        }
      } catch (error) {
        console.error('更新助手设置失败:', error)
      }
    }

    // 更新Redux全局状态
    setAdvancedMode(checked)
  }

  // 使用useCallback优化回调函数
  const handleWindowStyleChange = useCallback(
    (checked: boolean) => {
      setWindowStyle(checked ? 'transparent' : 'opaque')
    },
    [setWindowStyle]
  )

  const handleReset = useCallback(() => {
    setVisibleIcons([...DEFAULT_SIDEBAR_ICONS])
    setDisabledIcons([])
    dispatch(setSidebarIcons({ visible: DEFAULT_SIDEBAR_ICONS, disabled: [] }))
  }, [dispatch])

  const handleResetMinApps = useCallback(() => {
    setVisibleMiniApps(DEFAULT_MIN_APPS)
    setDisabledMiniApps([])
    updateMinapps(DEFAULT_MIN_APPS)
    updateDisabledMinapps([])
  }, [updateDisabledMinapps, updateMinapps])

  const themeOptions = useMemo(
    () => [
      {
        value: ThemeMode.light,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <i className="iconfont icon-theme icon-theme-light" />
            <span>{t('settings.theme.light')}</span>
          </div>
        )
      },
      {
        value: ThemeMode.dark,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <i className="iconfont icon-theme icon-dark1" />
            <span>{t('settings.theme.dark')}</span>
          </div>
        )
      },
      {
        value: ThemeMode.auto,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <SyncOutlined />
            <span>{t('settings.theme.auto')}</span>
          </div>
        )
      }
    ],
    [t]
  )

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.theme.title')}</SettingRowTitle>
          <Segmented value={theme} onChange={setTheme} options={themeOptions} />
        </SettingRow>
        {isMac && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.theme.window.style.transparent')}</SettingRowTitle>
              <Switch checked={windowStyle === 'transparent'} onChange={handleWindowStyleChange} />
            </SettingRow>
          </>
        )}
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.assistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.assistant.show.icon')}</SettingRowTitle>
          <Switch checked={showAssistantIcon} onChange={(checked) => setShowAssistantIcon(checked)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.topic.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.topic.position')}</SettingRowTitle>
          <Segmented
            value={topicPosition || 'right'}
            shape="round"
            onChange={setTopicPosition}
            options={[
              { value: 'left', label: t('settings.topic.position.left') },
              { value: 'right', label: t('settings.topic.position.right') }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        {topicPosition === 'left' && (
          <>
            <SettingRow>
              <SettingRowTitle>{t('settings.advanced.auto_switch_to_topics')}</SettingRowTitle>
              <Switch
                checked={clickAssistantToShowTopic}
                onChange={(checked) => dispatch(setClickAssistantToShowTopic(checked))}
              />
            </SettingRow>
            <SettingDivider />
          </>
        )}
        <SettingRow>
          <SettingRowTitle>{t('settings.topic.show.time')}</SettingRowTitle>
          <Switch checked={showTopicTime} onChange={(checked) => dispatch(setShowTopicTime(checked))} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle
          style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('settings.display.sidebar.title')}</span>
          <ResetButtonWrapper>
            <Button onClick={handleReset}>{t('common.reset')}</Button>
          </ResetButtonWrapper>
        </SettingTitle>
        <SettingDivider />
        <SidebarIconsManager
          visibleIcons={visibleIcons}
          disabledIcons={disabledIcons}
          setVisibleIcons={setVisibleIcons}
          setDisabledIcons={setDisabledIcons}
        />
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle
          style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('settings.display.minApp.title')}</span>
          <ResetButtonWrapper>
            <Button onClick={handleResetMinApps}>{t('common.reset')}</Button>
          </ResetButtonWrapper>
        </SettingTitle>
        <SettingDivider />
        <MiniAppIconsManager
          visibleMiniApps={visibleMiniApps}
          disabledMiniApps={disabledMiniApps}
          setVisibleMiniApps={setVisibleMiniApps}
          setDisabledMiniApps={setDisabledMiniApps}
        />
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.advanced.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            {t('settings.display.advanced_mode')}
            <WarningIcon style={{ marginLeft: 5, color: '#ff4d4f' }} />
          </SettingRowTitle>
          <Switch checked={advancedMode} onChange={toggleAdvancedMode} />
        </SettingRow>
        <AdvancedModeDescription>{t('settings.display.advanced.description')}</AdvancedModeDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.display.custom.css')}
          <TitleExtra onClick={() => window.api.openWebsite('https://cherrycss.com/')}>
            {t('settings.display.custom.css.cherrycss')}
          </TitleExtra>
        </SettingTitle>
        <SettingDivider />
        <Input.TextArea
          value={customCss}
          onChange={(e) => dispatch(setCustomCss(e.target.value))}
          placeholder={t('settings.display.custom.css.placeholder')}
          style={{
            minHeight: 200,
            fontFamily: 'monospace'
          }}
        />
      </SettingGroup>
    </SettingContainer>
  )
}

const TitleExtra = styled.div`
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  opacity: 0.7;
`
const ResetButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

const WarningIcon = styled(WarningOutlined)`
  font-size: 14px;
`

const AdvancedModeDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 5px;
  line-height: 1.5;
`

export default DisplaySettings
