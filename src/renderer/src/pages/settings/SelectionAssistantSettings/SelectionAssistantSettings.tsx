import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Radio, RadioGroup } from '@heroui/react'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { getSelectionDescriptionLabel } from '@renderer/i18n/label'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import type { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'
import { Row, Slider } from 'antd'
import { CircleHelp, Edit2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
import MacProcessTrustHintModal from './components/MacProcessTrustHintModal'
import SelectionActionsList from './components/SelectionActionsList'
import SelectionFilterListModal from './components/SelectionFilterListModal'

const SelectionAssistantSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [selectionEnabled, setSelectionEnabled] = usePreference('feature.selection.enabled')
  const [triggerMode, setTriggerMode] = usePreference('feature.selection.trigger_mode')
  const [isCompact, setIsCompact] = usePreference('feature.selection.compact')
  const [isAutoClose, setIsAutoClose] = usePreference('feature.selection.auto_close')
  const [isAutoPin, setIsAutoPin] = usePreference('feature.selection.auto_pin')
  const [isFollowToolbar, setIsFollowToolbar] = usePreference('feature.selection.follow_toolbar')
  const [isRemeberWinSize, setIsRemeberWinSize] = usePreference('feature.selection.remember_win_size')
  const [actionWindowOpacity, setActionWindowOpacity] = usePreference('feature.selection.action_window_opacity')
  const [filterMode, setFilterMode] = usePreference('feature.selection.filter_mode')
  const [filterList, setFilterList] = usePreference('feature.selection.filter_list')
  const [actionItems, setActionItems] = usePreference('feature.selection.action_items')

  const isSupportedOS = isWin || isMac

  const [isFilterListModalOpen, setIsFilterListModalOpen] = useState(false)
  const [isMacTrustModalOpen, setIsMacTrustModalOpen] = useState(false)
  const [opacityValue, setOpacityValue] = useState(actionWindowOpacity)

  // force disable selection assistant on non-windows systems
  useEffect(() => {
    const checkMacProcessTrust = async () => {
      const isTrusted = await window.api.mac.isProcessTrusted()
      if (!isTrusted) {
        setSelectionEnabled(false)
      }
    }

    if (!isSupportedOS && selectionEnabled) {
      setSelectionEnabled(false)
      return
    } else if (isMac && selectionEnabled) {
      checkMacProcessTrust()
    }
  }, [isSupportedOS, selectionEnabled, setSelectionEnabled])

  const handleEnableCheckboxChange = async (checked: boolean) => {
    if (!isSupportedOS) return

    if (isMac && checked) {
      const isTrusted = await window.api.mac.isProcessTrusted()
      if (!isTrusted) {
        setIsMacTrustModalOpen(true)
        return
      }
    }

    setSelectionEnabled(checked)
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <Row align="middle">
          <SettingTitle>{t('selection.name')}</SettingTitle>
          <Spacer />
          <Button
            variant="light"
            onPress={() => window.api.openWebsite('https://github.com/CherryHQ/cherry-studio/issues/6505')}
            style={{ fontSize: 12 }}>
            {'FAQ & ' + t('settings.about.feedback.button')}
          </Button>
          {isMac && <ExperimentalText>{t('selection.settings.experimental')}</ExperimentalText>}
        </Row>
        <SettingDivider />
        <SettingRow>
          <SettingLabel>
            <SettingRowTitle>{t('selection.settings.enable.title')}</SettingRowTitle>
            {!isSupportedOS && <SettingDescription>{t('selection.settings.enable.description')}</SettingDescription>}
          </SettingLabel>
          <Switch
            isSelected={isSupportedOS && selectionEnabled}
            onValueChange={handleEnableCheckboxChange}
            isDisabled={!isSupportedOS}
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
          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.toolbar.title')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>
                  <div style={{ marginRight: '4px' }}>{t('selection.settings.toolbar.trigger_mode.title')}</div>
                  {/* FIXME: 没有考虑Linux？ */}
                  <Tooltip content={getSelectionDescriptionLabel(isWin ? 'windows' : 'mac')}>
                    <QuestionIcon size={14} />
                  </Tooltip>
                </SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.trigger_mode.description')}</SettingDescription>
              </SettingLabel>
              <RadioGroup
                size="sm"
                orientation="horizontal"
                value={triggerMode}
                onValueChange={(value) => setTriggerMode(value as SelectionTriggerMode)}>
                <Tooltip content={t('selection.settings.toolbar.trigger_mode.selected_note')}>
                  <Radio value="selected">{t('selection.settings.toolbar.trigger_mode.selected')}</Radio>
                </Tooltip>
                {isWin && (
                  <Tooltip content={t('selection.settings.toolbar.trigger_mode.ctrlkey_note')}>
                    <Radio value="ctrlkey">{t('selection.settings.toolbar.trigger_mode.ctrlkey')}</Radio>
                  </Tooltip>
                )}
                <Tooltip
                 
                  content={
                    <div>
                      {t('selection.settings.toolbar.trigger_mode.shortcut_note')}
                      <Link to="/settings/shortcut" style={{ color: 'var(--color-primary)' }}>
                        {t('selection.settings.toolbar.trigger_mode.shortcut_link')}
                      </Link>
                    </div>
                  }>
                  <Radio value="shortcut">{t('selection.settings.toolbar.trigger_mode.shortcut')}</Radio>
                </Tooltip>
              </RadioGroup>
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.toolbar.compact_mode.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.compact_mode.description')}</SettingDescription>
              </SettingLabel>
              <Switch isSelected={isCompact} onValueChange={setIsCompact} />
            </SettingRow>
          </SettingGroup>

          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.window.title')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.follow_toolbar.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.follow_toolbar.description')}</SettingDescription>
              </SettingLabel>
              <Switch isSelected={isFollowToolbar} onValueChange={setIsFollowToolbar} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.remember_size.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.remember_size.description')}</SettingDescription>
              </SettingLabel>
              <Switch isSelected={isRemeberWinSize} onValueChange={setIsRemeberWinSize} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.auto_close.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.auto_close.description')}</SettingDescription>
              </SettingLabel>
              <Switch isSelected={isAutoClose} onValueChange={setIsAutoClose} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.auto_pin.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.auto_pin.description')}</SettingDescription>
              </SettingLabel>
              <Switch isSelected={isAutoPin} onValueChange={setIsAutoPin} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.window.opacity.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.opacity.description')}</SettingDescription>
              </SettingLabel>
              <div style={{ marginRight: '16px' }}>{opacityValue}%</div>
              <Slider
                style={{ width: 100 }}
                min={20}
                max={100}
                reverse
                value={opacityValue}
                onChange={setOpacityValue}
                onChangeComplete={setActionWindowOpacity}
                tooltip={{ open: false }}
              />
            </SettingRow>
          </SettingGroup>

          <SelectionActionsList actionItems={actionItems} setActionItems={setActionItems} />

          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.advanced.title')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.advanced.filter_mode.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.advanced.filter_mode.description')}</SettingDescription>
              </SettingLabel>
              <RadioGroup
                size="sm"
                orientation="horizontal"
                value={filterMode ?? 'default'}
                onValueChange={(value) => setFilterMode(value as SelectionFilterMode)}>
                <Radio value="default">{t('selection.settings.advanced.filter_mode.default')}</Radio>
                <Radio value="whitelist">{t('selection.settings.advanced.filter_mode.whitelist')}</Radio>
                <Radio value="blacklist">{t('selection.settings.advanced.filter_mode.blacklist')}</Radio>
              </RadioGroup>
            </SettingRow>

            {filterMode && filterMode !== 'default' && (
              <>
                <SettingDivider />
                <SettingRow>
                  <SettingLabel>
                    <SettingRowTitle>{t('selection.settings.advanced.filter_list.title')}</SettingRowTitle>
                    <SettingDescription>{t('selection.settings.advanced.filter_list.description')}</SettingDescription>
                  </SettingLabel>
                  <Button startContent={<Edit2 size={14} />} onPress={() => setIsFilterListModalOpen(true)}>
                    {t('common.edit')}
                  </Button>
                </SettingRow>
                <SelectionFilterListModal
                  open={isFilterListModalOpen}
                  onClose={() => setIsFilterListModalOpen(false)}
                  filterList={filterList}
                  onSave={setFilterList}
                />
              </>
            )}
          </SettingGroup>
        </>
      )}

      {isMac && <MacProcessTrustHintModal open={isMacTrustModalOpen} onClose={() => setIsMacTrustModalOpen(false)} />}
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
