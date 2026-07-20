import { Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
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
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AppInfo } from '@renderer/types/app'
import { cn } from '@renderer/utils/style'
import type { UserDataRelocationValidationReason } from '@shared/types/userDataRelocation'
import { FolderOpen, FolderOutput, SaveIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackupPopup from './BackupPopup'
import { BackupUnavailableGate } from './BackupUnavailableGate'
import RestorePopup from './RestorePopup'
const BasicDataSettings: React.FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheSize, setCacheSize] = useState<string>('')
  const { theme } = useTheme()
  const [skipBackupFile, setSkipBackupFile] = usePreference('data.backup.general.skip_backup_file')
  const [enableDataCollection, setEnableDataCollection] = usePreference('app.privacy.data_collection.enabled')

  useEffect(() => {
    void ipcApi.request('app.get_info').then(setAppInfo)
    void window.api.getCacheSize().then(setCacheSize)
  }, [])

  const handleSelectAppDataPath = async () => {
    if (!appInfo || !appInfo.appDataPath) {
      return
    }

    const newAppDataPath = await window.api.file.selectFolder({
      title: t('settings.data.app_data.select_title'),
      properties: ['openDirectory', 'createDirectory']
    })

    if (!newAppDataPath) {
      return
    }

    const inspection = await ipcApi.request('app.user_data_relocation.inspect', { path: newAppDataPath })
    if (!inspection.valid) {
      showRelocationValidationError(inspection.reason)
      return
    }

    void showMigrationConfirmModal(appInfo.appDataPath, newAppDataPath, !inspection.targetEmpty)
  }

  const showRelocationValidationError = (reason: UserDataRelocationValidationReason) => {
    if (reason === 'target_root') {
      toast.error(t('settings.data.app_data.select_error_root_path'))
    } else if (reason === 'same_path' || reason === 'target_inside_source' || reason === 'target_contains_source') {
      toast.error(t('settings.data.app_data.select_error_same_path'))
    } else if (reason === 'target_protected') {
      toast.error(t('settings.data.app_data.select_error_protected_path'))
    } else if (reason === 'target_in_use') {
      toast.error(t('settings.data.app_data.select_error'))
    } else if (reason === 'target_not_empty') {
      toast.error(t('settings.data.app_data.select_not_empty_dir'))
    } else if (
      reason === 'target_parent_unwritable' ||
      reason === 'source_missing' ||
      reason === 'target_not_directory'
    ) {
      toast.error(t('settings.data.app_data.select_error_write_permission'))
    } else {
      toast.error(t('settings.data.app_data.path_change_failed'))
    }
  }

  const showMigrationConfirmModal = async (originalPath: string, newPath: string, targetNotEmpty: boolean) => {
    let shouldCopyData = !targetNotEmpty

    const PathsContent = () => (
      <div>
        <MigrationPathRow>
          <MigrationPathLabel>{t('settings.data.app_data.original_path')}:</MigrationPathLabel>
          <MigrationPathValue>{originalPath}</MigrationPathValue>
        </MigrationPathRow>
        <MigrationPathRow style={{ marginTop: '16px' }}>
          <MigrationPathLabel>{t('settings.data.app_data.new_path')}:</MigrationPathLabel>
          <MigrationPathValue>{newPath}</MigrationPathValue>
        </MigrationPathRow>
      </div>
    )

    const CopyDataContent = () => (
      <div>
        <MigrationPathRow style={{ marginTop: '20px', flexDirection: 'row', alignItems: 'center' }}>
          <Switch
            defaultChecked={shouldCopyData}
            onCheckedChange={(checked) => (shouldCopyData = checked)}
            disabled={targetNotEmpty}
            className="mr-2"
          />
          <MigrationPathLabel style={{ fontWeight: 'normal', fontSize: '14px' }}>
            {t('settings.data.app_data.copy_data_option')}
          </MigrationPathLabel>
        </MigrationPathRow>
      </div>
    )

    const confirmed = await popup.confirm({
      title: <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>,
      className: 'migration-modal',
      width: 'min(600px, 90vw)',
      style: { minHeight: '400px' },
      content: (
        <MigrationModalContent>
          <PathsContent />
          <CopyDataContent />
          <MigrationNotice>
            <p style={{ color: 'var(--color-warning)' }}>{t('settings.data.app_data.restart_notice')}</p>
            <p style={{ color: 'var(--color-foreground-muted)', marginTop: '8px' }}>
              {targetNotEmpty
                ? t('settings.data.app_data.switch_existing_notice')
                : t('settings.data.app_data.copy_time_notice')}
            </p>
          </MigrationNotice>
        </MigrationModalContent>
      ),
      centered: true,
      okButtonProps: {
        danger: true
      },
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })
    if (!confirmed) return

    try {
      await ipcApi.request('app.user_data_relocation.request', {
        path: newPath,
        copy: shouldCopyData
      })
      toast.info({
        title: t('settings.data.app_data.restart_notice'),
        timeout: 2000
      })
      window.setTimeout(() => {
        void ipcApi.request('app.relaunch')
      }, 500)
    } catch {
      toast.error(t('settings.data.app_data.path_change_failed'))
    }
  }

  const handleOpenPath = (path?: string) => {
    if (!path) return
    if (path?.endsWith('log')) {
      const dirPath = path.split(/[/\\]/).slice(0, -1).join('/')
      void ipcApi.request('system.shell.open_path', dirPath)
    } else {
      void ipcApi.request('system.shell.open_path', path)
    }
  }

  const handleClearCache = async () => {
    const confirmed = await popup.confirm({
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.confirm'),
      okText: t('settings.data.clear_cache.button'),
      centered: true,
      okButtonProps: {
        danger: true
      }
    })
    if (!confirmed) return

    try {
      await window.api.clearCache()
      await window.api.trace.cleanLocalData()
      await window.api.getCacheSize().then(setCacheSize)
      toast.success(t('settings.data.clear_cache.success'))
    } catch (error) {
      toast.error(t('settings.data.clear_cache.error'))
    }
  }

  const handleFactoryReset = async () => {
    const confirmed = await popup.confirm({
      title: t('settings.data.factory_reset.confirm_title'),
      content: t('settings.data.factory_reset.confirm_content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      okButtonProps: {
        danger: true
      }
    })
    if (!confirmed) return

    try {
      // The final confirmation is a native dialog owned by the main-process
      // handler (arming a wipe must not hinge on renderer-side UI alone). On
      // confirm the app relaunches before this resolves — the preboot
      // factory-reset gate wipes on the next boot; on cancel it resolves
      // without staging anything. Only rejection (the reset marker could not
      // be persisted) is observable here.
      await ipcApi.request('app.factory_reset.request')
    } catch (error) {
      toast.error(t('settings.data.factory_reset.error'))
    }
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    void setSkipBackupFile(value)
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.title')}</SettingTitle>
        <SettingDivider />
        <BackupUnavailableGate>
          <SettingRow>
            <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
            <RowFlex className="justify-between gap-1.25">
              <Button onClick={() => BackupPopup.show()} variant="outline">
                <SaveIcon size={14} />
                {t('settings.general.backup.button')}
              </Button>
              <Button onClick={() => RestorePopup.show()} variant="outline">
                <FolderOpen size={14} />
                {t('settings.general.restore.button')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
            <Switch checked={skipBackupFile} onCheckedChange={onSkipBackupFilesChange} />
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
          </SettingRow>
        </BackupUnavailableGate>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.data.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_data.label')}</SettingRowTitle>
          <PathRow>
            <PathText
              style={{ color: 'var(--color-foreground-muted)' }}
              onClick={() => handleOpenPath(appInfo?.appDataPath)}>
              {appInfo?.appDataPath}
            </PathText>
            <Tooltip title={t('settings.data.app_data.select')}>
              <FolderOutput onClick={handleSelectAppDataPath} style={{ cursor: 'pointer' }} size={16} />
            </Tooltip>
            <RowFlex className="ml-2 gap-1.25">
              <Button onClick={() => handleOpenPath(appInfo?.appDataPath)} variant="outline">
                {t('settings.data.app_data.open')}
              </Button>
            </RowFlex>
          </PathRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_logs.label')}</SettingRowTitle>
          <PathRow>
            <PathText
              style={{ color: 'var(--color-foreground-muted)' }}
              onClick={() => handleOpenPath(appInfo?.logsPath)}>
              {appInfo?.logsPath}
            </PathText>
            <RowFlex className="ml-2 gap-1.25">
              <Button onClick={() => handleOpenPath(appInfo?.logsPath)} variant="outline">
                {t('settings.data.app_logs.button')}
              </Button>
            </RowFlex>
          </PathRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            {t('settings.data.clear_cache.title')}
            {cacheSize && <CacheText>({cacheSize}MB)</CacheText>}
          </SettingRowTitle>
          <RowFlex className="gap-1.25">
            <Button onClick={handleClearCache} variant="outline">
              {t('settings.data.clear_cache.button')}
            </Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.factory_reset.title')}</SettingRowTitle>
          <RowFlex className="gap-1.25">
            <Button onClick={handleFactoryReset} variant="destructive">
              {t('settings.data.factory_reset.button')}
            </Button>
          </RowFlex>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.privacy.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.privacy.enable_privacy_mode')}</SettingRowTitle>
          <Switch
            checked={enableDataCollection}
            onCheckedChange={(v) => {
              void setEnableDataCollection(v)
            }}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

const CacheText = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span
    className={cn('ml-1.25 inline-block text-left align-middle text-foreground-muted text-xs leading-4', className)}
    {...props}
  />
)

const PathText = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span
    className={cn('ml-1.25 inline-block min-w-0 flex-1 cursor-pointer truncate text-right align-middle', className)}
    {...props}
  />
)

const PathRow = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof RowFlex>) => (
  <RowFlex className={cn('w-0 min-w-0 flex-1 items-center gap-1.25', className)} {...props} />
)

const MigrationModalContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col py-5 pb-2.5', className)} {...props} />
)

const MigrationNotice = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-6 text-sm', className)} {...props} />
)

const MigrationPathRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-1.25', className)} {...props} />
)

const MigrationPathLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('font-semibold text-[15px] text-foreground', className)} {...props} />
)

const MigrationPathValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'break-all rounded border border-border bg-background-subtle px-3 py-2 text-foreground-secondary text-sm',
      className
    )}
    {...props}
  />
)

export default BasicDataSettings
