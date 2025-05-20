import { isWindows } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSelectionAssistant } from '@renderer/hooks/useSelectionAssistant'
import { TriggerMode } from '@renderer/types/selectionTypes'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { Radio, Row, Slider, Switch, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import SelectionActionsList from './SelectionActionsList'

const SelectionAssistantSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const {
    selectionEnabled,
    triggerMode,
    isCompact,
    isAutoClose,
    isAutoPin,
    isFollowToolbar,
    actionItems,
    actionWindowOpacity,
    setSelectionEnabled,
    setTriggerMode,
    setIsCompact,
    setIsAutoClose,
    setIsAutoPin,
    setIsFollowToolbar,
    setActionWindowOpacity,
    setActionItems
  } = useSelectionAssistant()

  // force disable selection assistant on non-windows systems
  useEffect(() => {
    if (!isWindows && selectionEnabled) {
      setSelectionEnabled(false)
    }
  }, [selectionEnabled, setSelectionEnabled])

  return (
    <SettingContainer theme={theme}>
      <SettingGroup>
        <Row>
          <SettingTitle>{t('selection.name')}</SettingTitle>
          <Spacer />
          <ExperimentalText>{t('selection.settings.experimental')}</ExperimentalText>
        </Row>
        <SettingDivider />
        <SettingRow>
          <SettingLabel>
            <SettingRowTitle>{t('selection.settings.enable.title')}</SettingRowTitle>
            {!isWindows && <SettingDescription>{t('selection.settings.enable.description')}</SettingDescription>}
          </SettingLabel>
          <Switch
            checked={isWindows && selectionEnabled}
            onChange={(checked) => setSelectionEnabled(checked)}
            disabled={!isWindows}
          />
        </SettingRow>

        {!selectionEnabled && (
          <DemoContainer>
            <SelectionToolbar demo />
          </DemoContainer>
        )}
      </SettingGroup>
      {selectionEnabled && (
        <>
          <SettingGroup>
            <SettingTitle>{t('selection.settings.toolbar.title')}</SettingTitle>
            <SettingDivider />

            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>
                  <div style={{ marginRight: '4px' }}>{t('selection.settings.toolbar.trigger_mode.title')}</div>
                  <Tooltip placement="top" title={t('selection.settings.toolbar.trigger_mode.description_note')} arrow>
                    <QuestionIcon size={14} />
                  </Tooltip>
                </SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.trigger_mode.description')}</SettingDescription>
              </SettingLabel>
              <Radio.Group
                value={triggerMode}
                onChange={(e) => setTriggerMode(e.target.value as TriggerMode)}
                buttonStyle="solid">
                <Radio.Button value="selected">{t('selection.settings.toolbar.trigger_mode.selected')}</Radio.Button>
                <Radio.Button value="ctrlkey">{t('selection.settings.toolbar.trigger_mode.ctrlkey')}</Radio.Button>
              </Radio.Group>
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.toolbar.compact_mode.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.compact_mode.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isCompact} onChange={(checked) => setIsCompact(checked)} />
            </SettingRow>
          </SettingGroup>

          <SettingGroup>
            <SettingTitle>{t('selection.settings.window.title')}</SettingTitle>
            <SettingDivider />

            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.follow_toolbar.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.follow_toolbar.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isFollowToolbar} onChange={(checked) => setIsFollowToolbar(checked)} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.auto_close.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.auto_close.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isAutoClose} onChange={(checked) => setIsAutoClose(checked)} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.auto_pin.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.auto_pin.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isAutoPin} onChange={(checked) => setIsAutoPin(checked)} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.opacity.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.opacity.description')}</SettingDescription>
              </SettingLabel>
              <div style={{ marginRight: '16px' }}>{actionWindowOpacity}%</div>
              <Slider
                style={{ width: 100 }}
                min={20}
                max={100}
                reverse
                value={actionWindowOpacity}
                onChange={setActionWindowOpacity}
                tooltip={{ open: false }}
              />
            </SettingRow>
          </SettingGroup>

          <SelectionActionsList actionItems={actionItems} setActionItems={setActionItems} />
        </>
      )}
    </SettingContainer>
  )
}

const Spacer = styled.div`
  flex: 1;
`
const SettingLabel = styled.div`
  flex: 1;
`

const ExperimentalText = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
`

const DemoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 15px;
  margin-bottom: 5px;
`

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

export default SelectionAssistantSettings
