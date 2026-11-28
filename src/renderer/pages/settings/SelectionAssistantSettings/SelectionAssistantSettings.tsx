import { Link } from '@tanstack/react-router'
import { CircleCheck, CircleX, Edit2, TriangleAlert } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, RadioGroup, RadioGroupItem, Slider, Switch, Tooltip, HelpTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import SelectionToolbarView from '@renderer/components/selection/SelectionToolbarView'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingsPageHeader,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getSelectionDescriptionLabelKey } from '@renderer/i18n/label'
import { ipcApi } from '@renderer/ipc'
import { openExternalWebsite } from '@renderer/services/website'
import { isLinux, isMac, isWin } from '@renderer/utils/platform'
import { parseSelectionActions } from '@renderer/utils/selectionAction'
import { cn } from '@renderer/utils/style'
import type { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'

import MacProcessTrustHintModal from './components/MacProcessTrustHintModal'
import SelectionActionsList from './components/SelectionActionsList'
import SelectionFilterListModal from './components/SelectionFilterListModal'

const SelectionAssistantSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [selectionEnabled, setSelectionEnabled] = usePreference('feature.selection.enabled')
  const [triggerMode, setTriggerMode] = usePreference('feature.selection.trigger_mode')
  const [isCompact, setIsCompact] = usePreference('feature.selection.compact')
  const [isTranslateOnly, setIsTranslateOnly] = usePreference('feature.selection.translate_only')
  const [isAutoClose, setIsAutoClose] = usePreference('feature.selection.auto_close')
  const [isAutoPin, setIsAutoPin] = usePreference('feature.selection.auto_pin')
  const [isFollowToolbar, setIsFollowToolbar] = usePreference('feature.selection.follow_toolbar')
  const [isRemeberWinSize, setIsRemeberWinSize] = usePreference('feature.selection.remember_win_size')
  const [actionWindowOpacity, setActionWindowOpacity] = usePreference('feature.selection.action_window_opacity')
  const [filterMode, setFilterMode] = usePreference('feature.selection.filter_mode')
  const [filterList, setFilterList] = usePreference('feature.selection.filter_list')
  const [actionItems, setActionItems] = usePreference('feature.selection.action_items')
  const actions = useMemo(() => parseSelectionActions(actionItems ?? []), [actionItems])

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
  const isLinuxWaylandDisplay = isLinux && !!linuxEnvInfo?.isLinuxWaylandDisplay
  // The selection hook cannot run on this compositor, so every setting below would be dead.
  const isCompositorIncompatible = isLinuxWaylandDisplay && !linuxEnvInfo?.isLinuxCompositorCompatible
  // Only show the Wayland block when something is still wrong; a fully satisfied checklist is noise.
  const showWaylandHint =
    isLinuxWaylandDisplay &&
    (isCompositorIncompatible || !linuxEnvInfo?.isLinuxXWaylandMode || !linuxEnvInfo?.hasLinuxInputDeviceAccess)

  // force disable selection assistant on non-windows systems
  useEffect(() => {
    const checkMacProcessTrust = async () => {
      const isTrusted = await ipcApi.request('system.mac.is_process_trusted')
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
      const isTrusted = await ipcApi.request('system.mac.is_process_trusted')
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
          className="mb-0"
          title={
            <>
              <span className="text-[15px] font-semibold">{t('selection.name')}</span>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-xs font-normal text-link hover:underline"
                onClick={() => openExternalWebsite('https://github.com/CherryHQ/cherry-studio/issues/6505')}>
                {'FAQ & ' + t('settings.about.feedback.button')}
              </button>
            </>
          }
          action={
            <div
              id="setting-selection-assistant-enable-selection-assistant"
              className="flex scroll-mt-6 items-center gap-2">
              <span className="text-xs font-normal text-muted-foreground">{t('selection.settings.enable.title')}</span>
              <Switch
                aria-label={t('selection.settings.enable.title')}
                checked={isSupportedOS && selectionEnabled}
                onCheckedChange={handleEnableCheckboxChange}
                disabled={!isSupportedOS}
              />
            </div>
          }
        />
        {(!selectionEnabled || !isSupportedOS || (showWaylandHint && linuxEnvInfo)) && (
          <>
            <SettingDivider />
            {!isSupportedOS && <SettingDescription>{t('selection.settings.enable.description')}</SettingDescription>}
            {!selectionEnabled && (
              <DemoContainer>
                <SelectionToolbarView
                  actionItems={actions.filter((item) => item.enabled)}
                  isCompact={isCompact}
                  handleAction={() => {}}
                  copyIconStatus="normal"
                  copyIconAnimation="none"
                />
              </DemoContainer>
            )}

            {selectionEnabled && showWaylandHint && linuxEnvInfo && (
              <>
                <SettingLabel>
                  <SettingRowTitle>
                    <TriangleAlert size={14} style={{ marginRight: 4, color: 'var(--error)' }} />
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
                          <CircleCheck size={13} style={{ color: 'var(--success)', marginRight: 6, flexShrink: 0 }} />
                        ) : (
                          <CircleX size={13} style={{ color: 'var(--error)', marginRight: 6, flexShrink: 0 }} />
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
                          <CircleCheck size={13} style={{ color: 'var(--success)', marginRight: 6, flexShrink: 0 }} />
                        ) : (
                          <CircleX size={13} style={{ color: 'var(--error)', marginRight: 6, flexShrink: 0 }} />
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
              </>
            )}
          </>
        )}
      </SettingGroup>
      {selectionEnabled && !isCompositorIncompatible && (
        <>
          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.toolbar.title')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  <div style={{ marginRight: '4px' }}>{t('selection.settings.toolbar.trigger_mode.title')}</div>
                  <HelpTooltip
                    content={
                      <div className="space-y-2">
                        <p>{t('selection.settings.toolbar.trigger_mode.description')}</p>
                        <p>{t(getSelectionDescriptionLabelKey(isWin ? 'windows' : isLinux ? 'linux' : 'mac'))}</p>
                      </div>
                    }
                  />
                </SettingRowTitle>
              </SettingLabel>
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
                      <Link to="/settings/shortcut" style={{ color: 'var(--link)' }}>
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
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.toolbar.compact_mode.title')}{' '}
                  <HelpTooltip content={t('selection.settings.toolbar.compact_mode.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <Switch checked={isCompact} onCheckedChange={setIsCompact} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle>{t('selection.settings.toolbar.translate_only.title')}</SettingRowTitle>
                <SettingDescription>{t('selection.settings.toolbar.translate_only.description')}</SettingDescription>
              </SettingLabel>
              <Switch checked={isTranslateOnly} onCheckedChange={setIsTranslateOnly} />
            </SettingRow>
          </SettingGroup>
          <SettingGroup theme={theme}>
            <SettingTitle>{t('selection.settings.window.title')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.window.follow_toolbar.title')}{' '}
                  <HelpTooltip content={t('selection.settings.window.follow_toolbar.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <Switch checked={isFollowToolbar} onCheckedChange={setIsFollowToolbar} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.window.remember_size.title')}{' '}
                  <HelpTooltip content={t('selection.settings.window.remember_size.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <Switch checked={isRemeberWinSize} onCheckedChange={setIsRemeberWinSize} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.window.auto_close.title')}{' '}
                  <HelpTooltip content={t('selection.settings.window.auto_close.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <Switch checked={isAutoClose} onCheckedChange={setIsAutoClose} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.window.auto_pin.title')}{' '}
                  <HelpTooltip content={t('selection.settings.window.auto_pin.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <Switch checked={isAutoPin} onCheckedChange={setIsAutoPin} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingLabel>
                <SettingRowTitle className="flex items-center gap-1.5">
                  {t('selection.settings.window.opacity.title')}{' '}
                  <HelpTooltip content={t('selection.settings.window.opacity.description')} />
                </SettingRowTitle>
              </SettingLabel>
              <div style={{ marginRight: '16px' }}>{opacityValue}%</div>
              <Slider
                className="w-25"
                min={20}
                max={100}
                value={[opacityValue]}
                onValueChange={(value) => setOpacityValue(value[0])}
                onValueCommit={(value) => setActionWindowOpacity(value[0])}
              />
            </SettingRow>
          </SettingGroup>
          <SelectionActionsList actionItems={actions} setActionItems={setActionItems} />
          {/* Wayland sessions report no program name, so filter mode never applies there. */}
          {!isLinuxWaylandDisplay && (
            <SettingGroup theme={theme}>
              <SettingTitle>{t('selection.settings.advanced.title')}</SettingTitle>
              <SettingDivider />
              <SettingRow>
                <SettingLabel>
                  <SettingRowTitle className="flex items-center gap-1.5">
                    {t('selection.settings.advanced.filter_mode.title')}{' '}
                    <HelpTooltip content={t('selection.settings.advanced.filter_mode.description')} />
                  </SettingRowTitle>
                </SettingLabel>
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
                  <SettingDivider />
                  <SettingRow>
                    <SettingLabel>
                      <SettingRowTitle className="flex items-center gap-1.5">
                        {t('selection.settings.advanced.filter_list.title')}{' '}
                        <HelpTooltip content={t('selection.settings.advanced.filter_list.description')} />
                      </SettingRowTitle>
                    </SettingLabel>
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
            </SettingGroup>
          )}
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
  <div className={cn('mt-8 mb-4 flex items-center justify-center', className)} {...props} />
)
const ChecklistItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-0.5 flex items-center text-xs text-foreground-tertiary', className)} {...props} />
)

export default SelectionAssistantSettings
