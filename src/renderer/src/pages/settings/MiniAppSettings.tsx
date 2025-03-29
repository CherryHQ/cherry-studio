import { UndoOutlined } from '@ant-design/icons' // 导入重置图标
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setMaxKeepAliveMinapps, setShowOpenedMinappsInSidebar } from '@renderer/store/settings'
import { Button, Slider, Switch, Tooltip } from 'antd'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingRowTitle, SettingTitle } from '.'
import MiniAppIconsManager from './DisplaySettings/MiniAppIconsManager'

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

  const handleResetMinApps = useCallback(() => {
    setVisibleMiniApps(DEFAULT_MIN_APPS)
    setDisabledMiniApps([])
    updateMinapps(DEFAULT_MIN_APPS)
    updateDisabledMinapps([])
  }, [updateDisabledMinapps, updateMinapps])

  // 恢复默认缓存数量
  const handleResetCacheLimit = useCallback(() => {
    dispatch(setMaxKeepAliveMinapps(DEFAULT_MAX_KEEPALIVE))
  }, [dispatch])

  return (
    <SettingContainer theme={theme}>
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
            <SliderContainer>
              <Slider
                min={1}
                max={5}
                value={maxKeepAliveMinapps}
                onChange={(value) => dispatch(setMaxKeepAliveMinapps(value))}
                marks={{
                  1: '1',
                  3: '3',
                  5: '5'
                }}
                tooltip={{ formatter: (value) => `${value}` }}
              />
              <Tooltip title={t('settings.miniapps.reset_tooltip')} placement="top">
                <ResetButton onClick={handleResetCacheLimit}>
                  <UndoOutlined />
                </ResetButton>
              </Tooltip>
            </SliderContainer>
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
  margin: px 0 0px;
  gap: 20px;
`

const SettingLabelGroup = styled.div`
  flex: 1;
`

// 新增控件容器，包含滑块和恢复默认按钮
const CacheSettingControls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 240px;
`

const SliderContainer = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;

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
