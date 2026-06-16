import { Button, RadioGroup, RadioGroupItem, Slider, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { getSelectionDescriptionLabelKey } from '@renderer/i18n/label'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import type { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'
import { Link } from '@tanstack/react-router'
import { CircleCheck, CircleX, Edit2, TextCursorInput, TriangleAlert } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingCard,
  SettingDescription,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingsPageHeader,
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

  const isSupportedOS = isWin || isMac || isLinux

  const [isFilterListModalOpen, setIsFilterListModalOpen] = useState(false)
  const [isMacTrustModalOpen, setIsMacTrustModalOpen] = useState(false)
  const [opacityValue, setOpacityValue] = useState(actionWindowOpacity)
  const [linuxEnvInfo, setLinuxEnvInfo] = useState<{
    isLinuxWaylandDisplay: boolean
    isLinuxXWaylandMode: boolean
    hasLinuxInputDeviceAccess: boolean
    isLinuxCompositorCompatible: boolean
  } | null>(null)

  // force disable selection assistant on non-windows systems
  useEffect(() => {
    const checkMacProcessTrust = async () => {
      const isTrusted = await window.api.mac.isProcessTrusted()
      if (!isTrusted) {
        void setSelectionEnabled(false)
      }
    }

    if (!isSupportedOS && selectionEnabled) {
      void setSelectionEnabled(false)
      return
    } else if (isMac && selectionEnabled) {
      void checkMacProcessTrust()
    }
  }, [isSupportedOS, selectionEnabled, setSelectionEnabled])

  useEffect(() => {
    if (isLinux) {
      void ipcApi.request('selection.get_linux_env_info').then(setLinuxEnvInfo)
    }
  }, [])

  const handleEnableCheckboxChange = async (checked: boolean) => {
    if (!isSupportedOS) return

    if (isMac && checked) {
      const isTrusted = await window.api.mac.isProcessTrusted()
      if (!isTrusted) {
        setIsMacTrustModalOpen(true)
        return
      }
    }

    void setSelectionEnabled(checked)
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingsPageHeader
          icon={<TextCursorInput />}
          title={t('selection.name')}
          description={t('selection.description')}
          action={
            <Button
              variant="link"
              size="sm"
              className="h-auto min-h-0 p-0 text-info shadow-none"
              onClick={() => window.api.openWebsite('https://github.com/CherryHQ/cherry-studio/issues/6505')}>
              {'FAQ & ' + t('settings.about.feedback.button')}
            </Button>
          }
        />
        <SettingCard>
          <SettingRow>
            <SettingLabel>
              <SettingRowTitle>{t('selection.settings.enable.title')}</SettingRowTitle>
              {!isSupportedOS && <SettingDescription>{t('selection.settings.enable.description')}</SettingDescription>}
            </SettingLabel>
            <Switch
              checked={isSupportedOS && selectionEnabled}
              onCheckedChange={handleEnableCheckboxChange}
              disabled={!isSupportedOS}
            />
          </SettingRow>

          {!selectionEnabled && (
            <DemoContainer>
              <SelectionToolbar demo />
            </DemoContainer>
          )}

          {selectionEnabled && isLinux && linuxEnvInfo?.isLinuxWaylandDisplay && (
            <SettingLabel>
              <SettingRowTitle>
                <TriangleAlert size={14} style={{ marginRight: 4, color: 'var(--color-error-base)' }} />
                {t('selection.settings.linux.wayland_title')}
              </SettingRowTitle>
              {linuxEnvInfo.isLinuxCompositorCompatible ? (
                <>
                  <SettingDescription>{t('selection.settings.linux.wayland_description')}</SettingDescription>
                  <SettingDescription style={{ marginTop: 6 }}>
                    {t('selection.settings.linux.wayland_checklist_subtitle')}
                  </SettingDescription>
                  <ChecklistItem style={{ marginTop: 6 }}>
                    {linuxEnvInfo.isLinuxXWaylandMode ? (
                      <CircleCheck
                        size={13}
                        style={{ color: 'var(--color-success-base)', marginRight: 6, flexShrink: 0 }}
                      />
                    ) : (
                      <CircleX size={13} style={{ color: 'var(--color-error-base)', marginRight: 6, flexShrink: 0 }} />
                    )}
                    <span>
                      {t('selection.settings.linux.xwayland_label')}
                      {linuxEnvInfo.isLinuxXWaylandMode
                        ? t('selection.settings.linux.xwayland_pass')
                        : t('selection.settings.linux.xwayland_fail')}
                    </span>
                  </ChecklistItem>
                  <ChecklistItem>
                    {linuxEnvInfo.hasLinuxInputDeviceAccess ? (
                      <CircleCheck
                        size={13}
                        style={{ color: 'var(--color-success-base)', marginRight: 6, flexShrink: 0 }}
                      />
                    ) : (
                      <CircleX size={13} style={{ color: 'var(--color-error-base)', marginRight: 6, flexShrink: 0 }} />
                    )}
                    <span>
                      {t('selection.settings.linux.input_group_label')}
                      {linuxEnvInfo.hasLinuxInputDeviceAccess
                        ? t('selection.settings.linux.input_group_pass')
                        : t('selection.settings.linux.input_group_fail')}
                    </span>
                  </ChecklistItem>
                </>
              ) : (
                <SettingDescription>{t('selection.settings.linux.compositor_incompatible')}</SettingDescription>
              )}
            </SettingLabel>
          )}
        </SettingCard>
      </SettingGroup>

      {selectionEnabled && (
        <>
          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.toolbar.title')}</SettingTitle>
            <SettingCard>
              <SettingRow>
                {/* FIXME: 没有考虑Linux？ */}
                <SettingRowTitle
                  className="flex-1"
                  tip={
                    <>
                      {t('selection.settings.toolbar.trigger_mode.description')}
                      <br />
                      {t(getSelectionDescriptionLabelKey(isWin ? 'windows' : isLinux ? 'linux' : 'mac'))}
                    </>
                  }>
                  {t('selection.settings.toolbar.trigger_mode.title')}
                </SettingRowTitle>
                <RadioGroup
                  value={triggerMode}
                  onValueChange={(value) => setTriggerMode(value as SelectionTriggerMode)}
                  className="flex flex-wrap gap-3">
                  <Tooltip content={t('selection.settings.toolbar.trigger_mode.selected_note')}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <RadioGroupItem size="sm" value="selected" />
                      <span>{t('selection.settings.toolbar.trigger_mode.selected')}</span>
                    </label>
                  </Tooltip>
                  {isWin && (
                    <Tooltip content={t('selection.settings.toolbar.trigger_mode.ctrlkey_note')}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <RadioGroupItem size="sm" value="ctrlkey" />
                        <span>{t('selection.settings.toolbar.trigger_mode.ctrlkey')}</span>
                      </label>
                    </Tooltip>
                  )}
                  <Tooltip
                    placement="top-end"
                    content={
                      <div>
                        {t('selection.settings.toolbar.trigger_mode.shortcut_note')}
                        <Link to="/settings/shortcut" style={{ color: 'var(--color-primary)' }}>
                          {t('selection.settings.toolbar.trigger_mode.shortcut_link')}
                        </Link>
                      </div>
                    }>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <RadioGroupItem size="sm" value="shortcut" />
                      <span>{t('selection.settings.toolbar.trigger_mode.shortcut')}</span>
                    </label>
                  </Tooltip>
                </RadioGroup>
              </SettingRow>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.toolbar.compact_mode.description')}>
                  {t('selection.settings.toolbar.compact_mode.title')}
                </SettingRowTitle>
                <Switch checked={isCompact} onCheckedChange={setIsCompact} />
              </SettingRow>
            </SettingCard>
          </SettingGroup>

          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.window.title')}</SettingTitle>
            <SettingCard>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.window.follow_toolbar.description')}>
                  {t('selection.settings.window.follow_toolbar.title')}
                </SettingRowTitle>
                <Switch checked={isFollowToolbar} onCheckedChange={setIsFollowToolbar} />
              </SettingRow>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.window.remember_size.description')}>
                  {t('selection.settings.window.remember_size.title')}
                </SettingRowTitle>
                <Switch checked={isRemeberWinSize} onCheckedChange={setIsRemeberWinSize} />
              </SettingRow>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.window.auto_close.description')}>
                  {t('selection.settings.window.auto_close.title')}
                </SettingRowTitle>
                <Switch checked={isAutoClose} onCheckedChange={setIsAutoClose} />
              </SettingRow>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.window.auto_pin.description')}>
                  {t('selection.settings.window.auto_pin.title')}
                </SettingRowTitle>
                <Switch checked={isAutoPin} onCheckedChange={setIsAutoPin} />
              </SettingRow>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.window.opacity.description')}>
                  {t('selection.settings.window.opacity.title')}
                </SettingRowTitle>
                <div style={{ marginRight: '16px' }}>{opacityValue}%</div>
                <Slider
                  className="w-25"
                  min={20}
                  max={100}
                  inverted
                  value={[opacityValue]}
                  onValueChange={(value) => setOpacityValue(value[0])}
                  onValueCommit={(value) => setActionWindowOpacity(value[0])}
                />
              </SettingRow>
            </SettingCard>
          </SettingGroup>

          <SelectionActionsList actionItems={actionItems} setActionItems={setActionItems} />

          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.advanced.title')}</SettingTitle>
            <SettingCard>
              <SettingRow>
                <SettingRowTitle className="flex-1" tip={t('selection.settings.advanced.filter_mode.description')}>
                  {t('selection.settings.advanced.filter_mode.title')}
                  {isLinux && linuxEnvInfo?.isLinuxWaylandDisplay && (
                    <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}>
                      （<TriangleAlert size={13} style={{ margin: '0 3px', color: 'var(--color-error-base)' }} />
                      {t('selection.settings.linux.filter_warning_text')}）
                    </span>
                  )}
                </SettingRowTitle>
                <RadioGroup
                  value={filterMode ?? 'default'}
                  onValueChange={(value) => setFilterMode(value as SelectionFilterMode)}
                  className="flex flex-wrap gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem size="sm" value="default" />
                    <span>{t('selection.settings.advanced.filter_mode.default')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem size="sm" value="whitelist" />
                    <span>{t('selection.settings.advanced.filter_mode.whitelist')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem size="sm" value="blacklist" />
                    <span>{t('selection.settings.advanced.filter_mode.blacklist')}</span>
                  </label>
                </RadioGroup>
              </SettingRow>

              {filterMode && filterMode !== 'default' && (
                <>
                  <SettingRow>
                    <SettingRowTitle className="flex-1" tip={t('selection.settings.advanced.filter_list.description')}>
                      {t('selection.settings.advanced.filter_list.title')}
                    </SettingRowTitle>
                    <Button onClick={() => setIsFilterListModalOpen(true)}>
                      <Edit2 size={14} />
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
            </SettingCard>
          </SettingGroup>
        </>
      )}

      {isMac && <MacProcessTrustHintModal open={isMacTrustModalOpen} onClose={() => setIsMacTrustModalOpen(false)} />}
    </SettingsContentColumn>
  )
}

const Spacer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex-1', className)} {...props} />
)
const SettingLabel = Spacer
const DemoContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-3.75 mb-1.25 flex items-center justify-center', className)} {...props} />
)
const ChecklistItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-0.5 flex items-center text-foreground-muted text-xs', className)} {...props} />
)

export default SelectionAssistantSettings
