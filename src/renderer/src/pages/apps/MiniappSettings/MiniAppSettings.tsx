import { UndoOutlined } from '@ant-design/icons' // 导入重置图标
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDescription, SettingDivider, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import {
  setMaxKeepAliveMinapps,
  setMinappsOpenLinkExternal,
  setShowOpenedMinappsInSidebar
} from '@renderer/store/settings'
import { Button, message, Slider, Switch, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MiniAppIconsManager from './MiniAppIconsManager'

// 默认小程序缓存数量
const DEFAULT_MAX_KEEPALIVE = 3

const MiniAppSettings: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { maxKeepAliveMinapps, showOpenedMinappsInSidebar, minappsOpenLinkExternal } = useSettings()
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

  const handleSwapMinApps = useCallback(() => {
    const temp = visibleMiniApps
    setVisibleMiniApps(disabledMiniApps)
    setDisabledMiniApps(temp)
  }, [disabledMiniApps, visibleMiniApps])

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
    <Container>
      {contextHolder} {/* 添加消息上下文 */}
      <SettingTitle style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        <ButtonWrapper>
          <Button onClick={handleSwapMinApps}>{t('common.swap')}</Button>
          <Button onClick={handleResetMinApps}>{t('common.reset')}</Button>
        </ButtonWrapper>
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
      <SettingRow style={{ height: 40, alignItems: 'center' }}>
        <SettingLabelGroup>
          <SettingRowTitle>{t('settings.miniapps.open_link_external.title')}</SettingRowTitle>
        </SettingLabelGroup>
        <Switch
          checked={minappsOpenLinkExternal}
          onChange={(checked) => dispatch(setMinappsOpenLinkExternal(checked))}
        />
      </SettingRow>
      <SettingDivider />
      {/* 缓存小程序数量设置 */}
      <SettingRow>
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
              max={10}
              value={maxKeepAliveMinapps}
              onChange={handleCacheChange}
              marks={{
                1: '1',
                5: '5',
                10: 'Max'
              }}
              tooltip={{ formatter: (value) => `${value}` }}
            />
          </SliderWithResetContainer>
        </CacheSettingControls>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingLabelGroup>
          <SettingRowTitle>{t('settings.miniapps.sidebar_title')}</SettingRowTitle>
          <SettingDescription>{t('settings.miniapps.sidebar_description')}</SettingDescription>
        </SettingLabelGroup>
        <Switch
          checked={showOpenedMinappsInSidebar}
          onChange={(checked) => dispatch(setShowOpenedMinappsInSidebar(checked))}
        />
      </SettingRow>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding-top: 10px;
`

// 修改和新增样式
const SettingRow = styled.div`
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

const ButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
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
