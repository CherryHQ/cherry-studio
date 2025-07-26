import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSelectionAssistant } from '@renderer/hooks/useSelectionAssistant'
import { getSelectionDescriptionLabel } from '@renderer/i18n/label'
import { FilterMode, TriggerMode } from '@renderer/types/selectionTypes'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { Button, Radio, Row, Slider, Switch, Tooltip } from 'antd'
import { CircleHelp, Edit2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
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
  const {
    selectionEnabled,
    triggerMode,
    isCompact,
    isAutoClose,
    isAutoPin,
    isFollowToolbar,
    isRemeberWinSize,
    actionItems,
    actionWindowOpacity,
    filterMode,
    filterList,
    setSelectionEnabled,
    setTriggerMode,
    setIsCompact,
    setIsAutoClose,
    setIsAutoPin,
    setIsFollowToolbar,
    setIsRemeberWinSize,
    setActionWindowOpacity,
    setActionItems,
    setFilterMode,
    setFilterList
  } = useSelectionAssistant()

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
      <SettingGroup>
        <Row align="middle">
          <SettingTitle>{t('selection.name')}</SettingTitle>
          <Spacer />
          <Button
            type="link"
            onClick={() => window.api.openWebsite('https://github.com/CherryHQ/cherry-studio/issues/6505')}
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
            checked={isSupportedOS && selectionEnabled}
            onChange={(checked) => handleEnableCheckboxChange(checked)}
            disabled={!isSupportedOS}
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
                  {/* FIXME: 没有考虑Linux？ */}
                  <Tooltip placement="top" title={getSelectionDescriptionLabel(isWin ? 'windows' : 'mac')} arrow>
                    <QuestionIcon size={14} />
                  </Tooltip>
                </SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.trigger_mode.description')}</SettingDescription>
              </SettingLabel>
              <Radio.Group
                value={triggerMode}
                onChange={(e) => setTriggerMode(e.target.value as TriggerMode)}
                buttonStyle="solid">
                <Tooltip placement="top" title={t('selection.settings.toolbar.trigger_mode.selected_note')} arrow>
                  <Radio.Button value="selected">{t('selection.settings.toolbar.trigger_mode.selected')}</Radio.Button>
                </Tooltip>
                {isWin && (
                  <Tooltip placement="top" title={t('selection.settings.toolbar.trigger_mode.ctrlkey_note')} arrow>
                    <Radio.Button value="ctrlkey">{t('selection.settings.toolbar.trigger_mode.ctrlkey')}</Radio.Button>
                  </Tooltip>
                )}
                <Tooltip
                  placement="topRight"
                  title={
                    <div>
                      {t('selection.settings.toolbar.trigger_mode.shortcut_note')}
                      <Link to="/settings/shortcut" style={{ color: 'var(--color-primary)' }}>
                        {t('selection.settings.toolbar.trigger_mode.shortcut_link')}
                      </Link>
                    </div>
                  }
                  arrow>
                  <Radio.Button value="shortcut">{t('selection.settings.toolbar.trigger_mode.shortcut')}</Radio.Button>
                </Tooltip>
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
                <SettingRowTitle>{t('selection.settings.window.remember_size.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.window.remember_size.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isRemeberWinSize} onChange={(checked) => setIsRemeberWinSize(checked)} />
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

          <SettingGroup>
            <SettingTitle>{t('selection.settings.advanced.title')}</SettingTitle>

            <SettingDivider />

            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.advanced.filter_mode.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.advanced.filter_mode.description')}</SettingDescription>
              </SettingLabel>
              <Radio.Group
                value={filterMode ?? 'default'}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                buttonStyle="solid">
                <Radio.Button value="default">{t('selection.settings.advanced.filter_mode.default')}</Radio.Button>
                <Radio.Button value="whitelist">{t('selection.settings.advanced.filter_mode.whitelist')}</Radio.Button>
                <Radio.Button value="blacklist">{t('selection.settings.advanced.filter_mode.blacklist')}</Radio.Button>
              </Radio.Group>
            </SettingRow>

            {filterMode && filterMode !== 'default' && (
              <>
                <SettingDivider />
                <SettingRow>
                  <SettingLabel>
                    <SettingRowTitle>{t('selection.settings.advanced.filter_list.title')}</SettingRowTitle>
                    <SettingDescription>{t('selection.settings.advanced.filter_list.description')}</SettingDescription>
                  </SettingLabel>
                  <Button icon={<Edit2 size={14} />} onClick={() => setIsFilterListModalOpen(true)}>
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
