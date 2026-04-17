import { InfoCircleOutlined, UndoOutlined } from '@ant-design/icons'
import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { SettingDescription, SettingDivider, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import type { MiniAppRegionFilter } from '@shared/data/types/miniapp'
import { Flex, Slider } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MiniAppIconsManager from './MiniAppIconsManager'

// Default max keep-alive miniapp count
const DEFAULT_MAX_KEEPALIVE = 3

// Region selector component with defensive default value
const RegionSelector: FC = () => {
  const { t } = useTranslation()
  const [miniAppRegion = 'auto', setMiniAppRegion] = usePreference('feature.miniapp.region')

  const onMiniAppRegionChange = (value: MiniAppRegionFilter) => {
    void setMiniAppRegion(value)
  }

  const miniAppRegionOptions: { value: MiniAppRegionFilter; label: string }[] = [
    { value: 'auto', label: t('settings.miniapps.region.auto') },
    { value: 'CN', label: t('settings.miniapps.region.cn') },
    { value: 'Global', label: t('settings.miniapps.region.global') }
  ]

  return <Selector size={14} value={miniAppRegion} onChange={onMiniAppRegionChange} options={miniAppRegionOptions} />
}

const MiniAppSettings: FC = () => {
  const { t } = useTranslation()

  const [maxKeepAliveMiniApps, setMaxKeepAliveMiniApps] = usePreference('feature.miniapp.max_keep_alive')
  const [showOpenedMiniAppsInSidebar, setShowOpenedMiniAppsInSidebar] = usePreference(
    'feature.miniapp.show_opened_in_sidebar'
  )
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.miniapp.open_link_external')

  const { miniapps, disabled, updateMiniApps, updateDisabledMiniApps } = useMiniApps()

  const [visibleMiniApps, setVisibleMiniApps] = useState(miniapps)
  const [disabledMiniApps, setDisabledMiniApps] = useState(disabled || [])
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Sync local state when store data changes (e.g. switching regions)
  useEffect(() => {
    setVisibleMiniApps(miniapps)
    setDisabledMiniApps(disabled || [])
  }, [miniapps, disabled])

  const handleResetMiniApps = useCallback(() => {
    // Only reset to apps visible in the current region to avoid confusion
    setVisibleMiniApps(miniapps)
    setDisabledMiniApps([])
    void updateMiniApps(miniapps)
    void updateDisabledMiniApps([])
  }, [miniapps, updateDisabledMiniApps, updateMiniApps])

  const handleSwapMiniApps = useCallback(() => {
    const temp = visibleMiniApps
    setVisibleMiniApps(disabledMiniApps)
    setDisabledMiniApps(temp)
  }, [disabledMiniApps, visibleMiniApps])

  // Restore default cache count
  const handleResetCacheLimit = useCallback(() => {
    void setMaxKeepAliveMiniApps(DEFAULT_MAX_KEEPALIVE)
    window.toast.info(t('settings.miniapps.cache_change_notice'))
  }, [t, setMaxKeepAliveMiniApps])

  // Handle cache count change
  const handleCacheChange = useCallback(
    (value: number) => {
      void setMaxKeepAliveMiniApps(value)

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        window.toast.info(t('settings.miniapps.cache_change_notice'))
        debounceTimerRef.current = null
      }, 500)
    },
    [t, setMaxKeepAliveMiniApps]
  )

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return (
    <Container>
      <SettingTitle style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        <ButtonWrapper>
          <Button onClick={handleSwapMiniApps}>{t('common.swap')}</Button>
          <Button onClick={handleResetMiniApps}>{t('common.reset')}</Button>
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
      {/* MiniApp region setting */}
      <SettingRow style={{ height: 40, alignItems: 'center' }}>
        <Flex align="center" gap={4}>
          <SettingRowTitle>{t('settings.miniapps.region.title')}</SettingRowTitle>
          <Tooltip title={t('settings.miniapps.region.description')} placement="right">
            <InfoCircleOutlined style={{ cursor: 'pointer' }} />
          </Tooltip>
        </Flex>
        <RegionSelector />
      </SettingRow>
      <SettingDivider />
      <SettingRow style={{ height: 40, alignItems: 'center' }}>
        <SettingLabelGroup>
          <SettingRowTitle>{t('settings.miniapps.open_link_external.title')}</SettingRowTitle>
        </SettingLabelGroup>
        <Switch checked={openLinkExternal} onCheckedChange={(checked) => setOpenLinkExternal(checked)} />
      </SettingRow>
      <SettingDivider />
      {/* Cached miniapp count setting */}
      <SettingRow>
        <SettingLabelGroup>
          <SettingRowTitle>{t('settings.miniapps.cache_title')}</SettingRowTitle>
          <SettingDescription>{t('settings.miniapps.cache_description')}</SettingDescription>
        </SettingLabelGroup>
        <CacheSettingControls>
          <SliderWithResetContainer>
            <Tooltip content={t('settings.miniapps.reset_tooltip')}>
              <ResetButton onClick={handleResetCacheLimit}>
                <UndoOutlined />
              </ResetButton>
            </Tooltip>
            <Slider
              min={1}
              max={10}
              value={maxKeepAliveMiniApps}
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
          checked={showOpenedMiniAppsInSidebar}
          onCheckedChange={(checked) => setShowOpenedMiniAppsInSidebar(checked)}
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

// SettingRow styles
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

// Slider and reset button container
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

// Reset button styles
const ResetButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px; /* Prevent shrinking */
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

// Bordered container component
const BorderedContainer = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  margin: 8px 0 8px;
  background-color: var(--color-bg-1);
`

export default MiniAppSettings
