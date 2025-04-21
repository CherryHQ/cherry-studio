import { UndoOutlined } from '@ant-design/icons' // 导入重置图标
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setMaxKeepAliveMinapps, setShowOpenedMinappsInSidebar } from '@renderer/store/settings'
import { Button, message, Slider, Switch, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingRowTitle, SettingTitle } from '..'
import MiniAppIconsManager from './MiniAppIconsManager'

// 默认小程序缓存数量
const DEFAULT_MAX_KEEPALIVE = 3

const MiniAppSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { maxKeepAliveMinapps, showOpenedMinappsInSidebar } = useSettings()
  const { minapps, disabled, updateMinapps, updateDisabledMinapps } = useMinapps()

  const [visibleMiniApps, setVisibleMiniApps] = useState(minapps)
  const [disabledMiniApps, setDisabledMiniApps] = useState(disabled || [])
  const [messageApi, contextHolder] = message.useMessage()
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleResetMinApps = useCallback(() => {
    setVisibleMiniApps(DEFAULT_MIN_APPS)
    setDisabledMiniApps([])
    updateMinapps(DEFAULT_MIN_APPS)
    updateDisabledMinapps([])
  }, [updateDisabledMinapps, updateMinapps])

  // 恢复默认缓存数量
  const handleResetCacheLimit = useCallback(() => {
    dispatch(setMaxKeepAliveMinapps(DEFAULT_MAX_KEEPALIVE))
    messageApi.info(t('settings.miniapps.cache_change_notice'))
  }, [dispatch, messageApi, t])

  // 处理缓存数量变更
  const handleCacheChange = useCallback(
    (value: number) => {
      dispatch(setMaxKeepAliveMinapps(value))

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        messageApi.info(t('settings.miniapps.cache_change_notice'))
        debounceTimerRef.current = null
      }, 500)
    },
    [dispatch, messageApi, t]
  )

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return (
    <SettingContainer theme={theme}>
      {contextHolder} {/* 添加消息上下文 */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.miniapps.title')}</SettingTitle>
        <SettingDivider />
        <SettingTitle
          style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('settings.miniapps.display_title')}</span>
          <ResetButtonWrapper>
            <Button onClick={handleResetMinApps}>{t('common.reset')}</Button>
          </ResetButtonWrapper>
        </SettingTitle>
        <BorderedContainer>
          <MiniAppIconsManager
            visibleMiniApps={visibleMiniApps}
            disabledMiniApps={disabledMiniApps}
            setVisibleMiniApps={setVisibleMiniApps}
            setDisabledMiniApps={setDisabledMiniApps}
          />
        </BorderedContainer>
        <SettingDivider />

        {/* 缓存小程序数量设置 */}
        <CacheSettingRow>
          <SettingLabelGroup>
            <SettingRowTitle>{t('settings.miniapps.cache_title')}</SettingRowTitle>
            <SettingDescription>{t('settings.miniapps.cache_description')}</SettingDescription>
          </SettingLabelGroup>
          <CacheSettingControls>
            <SliderWithResetContainer>
              <Tooltip title={t('settings.miniapps.reset_tooltip')} placement="top">
                <ResetButton onClick={handleResetCacheLimit}>
                  <UndoOutlined />
                </ResetButton>
              </Tooltip>
              <Slider
                min={1}
                max={5}
                value={maxKeepAliveMinapps}
                onChange={handleCacheChange}
                marks={{
                  1: '1',
                  3: '3',
                  5: '5'
                }}
                tooltip={{ formatter: (value) => `${value}` }}
              />
            </SliderWithResetContainer>
          </CacheSettingControls>
        </CacheSettingRow>
        <SettingDivider />
        <SidebarSettingRow>
          <SettingLabelGroup>
            <SettingRowTitle>{t('settings.miniapps.sidebar_title')}</SettingRowTitle>
            <SettingDescription>{t('settings.miniapps.sidebar_description')}</SettingDescription>
          </SettingLabelGroup>
          <Switch
            checked={showOpenedMinappsInSidebar}
            onChange={(checked) => dispatch(setShowOpenedMinappsInSidebar(checked))}
          />
        </SidebarSettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

// 修改和新增样式
const CacheSettingRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin: 0;
  gap: 20px;
`

const SettingLabelGroup = styled.div`
  flex: 1;
`

// 新增控件容器，包含滑块和恢复默认按钮
const CacheSettingControls = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 240px;
`

const SliderWithResetContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;

  .ant-slider {
    flex: 1;
  }

  .ant-slider-track {
    background-color: var(--color-primary);
  }

  .ant-slider-handle {
    border-color: var(--color-primary);
  }
`

// 重置按钮样式
const ResetButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px; /* 确保不会被压缩 */
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg-1);
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
  color: var(--color-text);

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &:active {
    background-color: var(--color-bg-2);
  }
`

const ResetButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

// 新增侧边栏设置行样式
const SidebarSettingRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
`

// 新增: 带边框的容器组件
const BorderedContainer = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  margin: 8px 0 8px;
  background-color: var(--color-bg-1);
`

export default MiniAppSettings
