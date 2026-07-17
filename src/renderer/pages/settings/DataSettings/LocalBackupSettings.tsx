import { Button, Input, RowFlex, Switch, WarnTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import Selector from '@renderer/components/Selector'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { getBackupSyncState, startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { toast } from '@renderer/services/toast'
import type { AppInfo } from '@renderer/types/app'
import dayjs from 'dayjs'
import { FolderOpen, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackupExportV2Popup from './BackupExportV2Popup'
import { LegacyLocalBackupGate } from './LegacyLocalBackupGate'
import RestoreV2Popup from './RestoreV2Popup'
import { V2BackupActionGate } from './V2BackupActionGate'
const logger = loggerService.withContext('LocalBackupSettings')

const LocalBackupSettings: React.FC = () => {
  const [, setLocalBackupAutoSync] = usePreference('data.backup.local.auto_sync')
  const [localBackupDir, setLocalBackupDir] = usePreference('data.backup.local.dir')
  const [localBackupMaxBackups, setLocalBackupMaxBackups] = usePreference('data.backup.local.max_backups')
  const [localBackupSkipBackupFile, setLocalBackupSkipBackupFile] = usePreference('data.backup.local.skip_backup_file')
  const [localBackupSyncInterval, setLocalBackupSyncInterval] = usePreference('data.backup.local.sync_interval')

  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    void ipcApi.request('app.get_info').then(setAppInfo)
  }, [])

  const { theme } = useTheme()

  const { t } = useTranslation()

  const { localBackupSync } = getBackupSyncState()

  const onSyncIntervalChange = (value: number) => {
    void setLocalBackupSyncInterval(value)
    if (value === 0) {
      void setLocalBackupAutoSync(false)
      stopAutoSync('local')
    } else {
      void setLocalBackupAutoSync(true)
      void startAutoSync(false, 'local')
    }
  }

  const checkLocalBackupDirValid = async (dir: string) => {
    if (dir === '') {
      return false
    }

    const resolvedDir = await window.api.resolvePath(dir)

    // check new local backup dir is not in app data path
    // if is in app data path, show error
    if (await window.api.isPathInside(resolvedDir, appInfo!.appDataPath)) {
      toast.error(t('settings.data.local.directory.select_error_app_data_path'))
      return false
    }

    // check new local backup dir is not in app install path
    // if is in app install path, show error
    if (await window.api.isPathInside(resolvedDir, appInfo!.installPath)) {
      toast.error(t('settings.data.local.directory.select_error_in_app_install_path'))
      return false
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(resolvedDir)
    if (!hasWritePermission) {
      toast.error(t('settings.data.local.directory.select_error_write_permission'))
      return false
    }

    return true
  }

  const handleLocalBackupDirChange = async (value: string) => {
    if (value === localBackupDir) {
      return
    }

    if (value === '') {
      void handleClearDirectory()
      return
    }

    if (await checkLocalBackupDirValid(value)) {
      await setLocalBackupDir(value)

      await setLocalBackupAutoSync(true)
      void startAutoSync(true, 'local')
      return
    }

    if (localBackupDir) {
      await setLocalBackupDir(localBackupDir)
      return
    }
  }

  const onMaxBackupsChange = (value: number) => {
    void setLocalBackupMaxBackups(value)
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    void setLocalBackupSkipBackupFile(value)
  }

  const handleBrowseDirectory = async () => {
    try {
      const newLocalBackupDir = await window.api.select({
        properties: ['openDirectory', 'createDirectory'],
        title: t('settings.data.local.directory.select_title')
      })

      if (!newLocalBackupDir) {
        return
      }

      await handleLocalBackupDirChange(newLocalBackupDir)
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
    }
  }

  const handleClearDirectory = async () => {
    await setLocalBackupDir('')
    await setLocalBackupAutoSync(false)
    stopAutoSync('local')
  }

  const renderSyncStatus = () => {
    if (!localBackupDir) return null

    if (!localBackupSync.lastSyncTime && !localBackupSync.syncing && !localBackupSync.lastSyncError) {
      return <span style={{ color: 'var(--color-foreground-secondary)' }}>{t('settings.data.local.noSync')}</span>
    }

    return (
      <RowFlex className="items-center gap-1.25">
        {localBackupSync.syncing && <RefreshCw className="animate-spin" size={14} />}
        {!localBackupSync.syncing && localBackupSync.lastSyncError && (
          <WarnTooltip
            content={`${t('settings.data.local.syncError')}: ${localBackupSync.lastSyncError}`}
            iconProps={{ style: { color: 'red' } }}
          />
        )}
        {localBackupSync.lastSyncTime && (
          <span style={{ color: 'var(--color-foreground-secondary)' }}>
            {t('settings.data.local.lastSync')}: {dayjs(localBackupSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </RowFlex>
    )
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.local.title')}</SettingTitle>
      <SettingDivider />
      <V2BackupActionGate>
        <SettingRow>
          <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
          <RowFlex className="justify-between gap-1.25">
            <Button onClick={() => BackupExportV2Popup.show()} variant="outline">
              <Save size={14} />
              {t('settings.data.local.backup.button')}
            </Button>
            <Button onClick={() => RestoreV2Popup.show()} variant="outline">
              <FolderOpen size={14} />
              {t('settings.data.local.restore.button')}
            </Button>
          </RowFlex>
        </SettingRow>
      </V2BackupActionGate>
      <SettingDivider />
      <LegacyLocalBackupGate>
        <SettingRow>
          <SettingRowTitle>{t('settings.data.local.directory.label')}</SettingRowTitle>
          <RowFlex className="gap-1.25">
            <Input
              value={localBackupDir}
              onChange={(e) => setLocalBackupDir(e.target.value)}
              onBlur={(e) => handleLocalBackupDirChange(e.target.value)}
              placeholder={t('settings.data.local.directory.placeholder')}
              style={{ minWidth: 200, maxWidth: 400, flex: 1 }}
            />
            <Button onClick={handleBrowseDirectory} variant="outline">
              <FolderOpen size={14} />
              {t('common.browse')}
            </Button>
            <Button onClick={handleClearDirectory} disabled={!localBackupDir} variant="destructive">
              <Trash2 size={14} />
              {t('common.clear')}
            </Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.local.autoSync.label')}</SettingRowTitle>
          <Selector
            size={14}
            value={localBackupSyncInterval}
            onChange={onSyncIntervalChange}
            disabled={!localBackupDir}
            options={[
              { label: t('settings.data.local.autoSync.off'), value: 0 },
              { label: t('settings.data.local.minute_interval', { count: 1 }), value: 1 },
              { label: t('settings.data.local.minute_interval', { count: 5 }), value: 5 },
              { label: t('settings.data.local.minute_interval', { count: 15 }), value: 15 },
              { label: t('settings.data.local.minute_interval', { count: 30 }), value: 30 },
              { label: t('settings.data.local.hour_interval', { count: 1 }), value: 60 },
              { label: t('settings.data.local.hour_interval', { count: 2 }), value: 120 },
              { label: t('settings.data.local.hour_interval', { count: 6 }), value: 360 },
              { label: t('settings.data.local.hour_interval', { count: 12 }), value: 720 },
              { label: t('settings.data.local.hour_interval', { count: 24 }), value: 1440 }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.local.maxBackups.label')}</SettingRowTitle>
          <Selector
            size={14}
            value={localBackupMaxBackups}
            onChange={onMaxBackupsChange}
            disabled={!localBackupDir}
            options={[
              { label: t('settings.data.local.maxBackups.unlimited'), value: 0 },
              { label: '1', value: 1 },
              { label: '3', value: 3 },
              { label: '5', value: 5 },
              { label: '10', value: 10 },
              { label: '20', value: 20 },
              { label: '50', value: 50 }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
          <Switch checked={localBackupSkipBackupFile} onCheckedChange={onSkipBackupFilesChange} />
        </SettingRow>
        <SettingRow>
          <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
        </SettingRow>
        {localBackupSync && localBackupSyncInterval > 0 && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.data.local.syncStatus')}</SettingRowTitle>
              {renderSyncStatus()}
            </SettingRow>
          </>
        )}
      </LegacyLocalBackupGate>
    </SettingGroup>
  )
}

export default LocalBackupSettings
