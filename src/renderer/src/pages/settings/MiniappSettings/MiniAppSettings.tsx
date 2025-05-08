import { UndoOutlined } from '@ant-design/icons' // 导入重置图标
import {
  DEFAULT_MIN_APPS,
  loadCustomMiniApp,
  ORIGIN_DEFAULT_MIN_APPS,
  updateDefaultMinApps
} from '@renderer/config/minapps'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import {
  setMaxKeepAliveMinapps,
  setMinappsOpenLinkExternal,
  setShowOpenedMinappsInSidebar
} from '@renderer/store/settings'
import { Button, Input, message, Slider, Switch, Tooltip } from 'antd'
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
  const { maxKeepAliveMinapps, showOpenedMinappsInSidebar, minappsOpenLinkExternal } = useSettings()
  const { minapps, disabled, updateMinapps, updateDisabledMinapps } = useMinapps()

  const [visibleMiniApps, setVisibleMiniApps] = useState(minapps)
  const [disabledMiniApps, setDisabledMiniApps] = useState(disabled || [])
  const [messageApi, contextHolder] = message.useMessage()
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [customMiniAppContent, setCustomMiniAppContent] = useState('[]')

  // 加载自定义小应用配置
  useEffect(() => {
    const loadCustomMiniApp = async () => {
      try {
        const content = await window.api.file.read('customMiniAPP')
        let validContent = '[]'
        try {
          const parsed = JSON.parse(content)
          validContent = JSON.stringify(parsed)
        } catch (e) {
          console.error('Invalid JSON format in custom mini app config:', e)
        }
        setCustomMiniAppContent(validContent)
      } catch (error) {
        console.error('Failed to load custom mini app config:', error)
        setCustomMiniAppContent('[]')
      }
    }
    loadCustomMiniApp()
  }, [])

  // 保存自定义小应用配置
  const handleSaveCustomMiniApp = useCallback(async () => {
    try {
      // 验证 JSON 格式
      if (customMiniAppContent === '') {
        setCustomMiniAppContent('[]')
      }
      const parsedContent = JSON.parse(customMiniAppContent)
      // 确保是数组
      if (!Array.isArray(parsedContent)) {
        throw new Error('Content must be an array')
      }

      // 检查自定义应用中的重复ID
      const customIds = new Set<string>()
      const duplicateIds = new Set<string>()
      parsedContent.forEach((app: any) => {
        if (app.id) {
          if (customIds.has(app.id)) {
            duplicateIds.add(app.id)
          }
          customIds.add(app.id)
        }
      })

      // 检查与默认应用的ID重复
      const defaultIds = new Set(ORIGIN_DEFAULT_MIN_APPS.map((app) => app.id))
      const conflictingIds = new Set<string>()
      customIds.forEach((id) => {
        if (defaultIds.has(id)) {
          conflictingIds.add(id)
        }
      })

      // 如果有重复ID，显示错误信息
      if (duplicateIds.size > 0 || conflictingIds.size > 0) {
        let errorMessage = ''
        if (duplicateIds.size > 0) {
          errorMessage += t('settings.miniapps.custom.duplicate_ids', { ids: Array.from(duplicateIds).join(', ') })
        }
        if (conflictingIds.size > 0) {
          console.log('conflictingIds', Array.from(conflictingIds))
          if (errorMessage) errorMessage += '\n'
          errorMessage += t('settings.miniapps.custom.conflicting_ids', { ids: Array.from(conflictingIds).join(', ') })
        }
        messageApi.error(errorMessage)
        return
      }

      // 保存文件
      await window.api.file.writeWithId('customMiniAPP', customMiniAppContent)
      messageApi.success(t('settings.miniapps.custom.save_success'))
      // 重新加载应用列表
      console.log('Reloading mini app list...')
      const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
      updateDefaultMinApps(reloadedApps)
      console.log('Reloaded mini app list:', reloadedApps)
      updateMinapps(reloadedApps)
    } catch (error) {
      messageApi.error(t('settings.miniapps.custom.save_error'))
      console.error('Failed to save custom mini app config:', error)
    }
  }, [customMiniAppContent, messageApi, t, updateMinapps])

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
        <SettingDivider />
        <SettingRow>
          <SettingLabelGroup>
            <SettingRowTitle>{t('settings.miniapps.custom.edit_title')}</SettingRowTitle>
            <SettingDescription>{t('settings.miniapps.custom.edit_description')}</SettingDescription>
          </SettingLabelGroup>
        </SettingRow>
        <CustomEditorContainer>
          <Input.TextArea
            value={customMiniAppContent}
            onChange={(e) => setCustomMiniAppContent(e.target.value)}
            placeholder={t('settings.miniapps.custom.placeholder')}
            style={{
              minHeight: 200,
              fontFamily: 'monospace',
              backgroundColor: 'var(--color-bg-2)',
              color: 'var(--color-text)',
              borderColor: 'var(--color-border)'
            }}
          />
          <Button type="primary" onClick={handleSaveCustomMiniApp} style={{ marginTop: 8 }}>
            {t('settings.miniapps.custom.save')}
          </Button>
        </CustomEditorContainer>
      </SettingGroup>
    </SettingContainer>
  )
}

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

const ResetButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

// 新增: 带边框的容器组件
const BorderedContainer = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  margin: 8px 0 8px;
  background-color: var(--color-bg-1);
`

// 新增自定义编辑器容器样式
const CustomEditorContainer = styled.div`
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background-color: var(--color-bg-1);

  .ant-input {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
  }
`

export default MiniAppSettings
