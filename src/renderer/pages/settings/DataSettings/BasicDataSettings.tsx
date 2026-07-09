import { Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import { LanTransferPopup } from '@renderer/components/Popups/LanTransferPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import { reset } from '@renderer/services/BackupService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AppInfo } from '@renderer/types/app'
import { cn } from '@renderer/utils/style'
import { isProtectedSystemPathOrDescendant } from '@shared/utils/file'
import { FolderInput, FolderOpen, FolderOutput, SaveIcon, Wifi } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const BasicDataSettings: React.FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheSize, setCacheSize] = useState<string>('')
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const [skipBackupFile, setSkipBackupFile] = usePreference('data.backup.general.skip_backup_file')
  const [enableDataCollection, setEnableDataCollection] = usePreference('app.privacy.data_collection.enabled')

  useEffect(() => {
    void window.api.getAppInfo().then(setAppInfo)
    void window.api.getCacheSize().then(setCacheSize)
  }, [])

  const handleSelectAppDataPath = async () => {
    if (!appInfo || !appInfo.appDataPath) {
      return
    }

    const newAppDataPath = await window.api.select({
      properties: ['openDirectory', 'createDirectory'],
      title: t('settings.data.app_data.select_title')
    })

    if (!newAppDataPath) {
      return
    }

    // check new app data path is a protected system path
    if (isProtectedSystemPathOrDescendant(newAppDataPath)) {
      toast.error(t('settings.data.app_data.select_error_system_path'))
      return
    }

    // check new app data path is root path
    const pathParts = newAppDataPath.split(/[/\\]/).filter((part: string) => part !== '')
    if (pathParts.length <= 1) {
      toast.error(t('settings.data.app_data.select_error_root_path'))
      return
    }

    // check new app data path is not in old app data path
    const isInOldPath = await window.api.isPathInside(newAppDataPath, appInfo.appDataPath)
    if (isInOldPath) {
      toast.error(t('settings.data.app_data.select_error_same_path'))
      return
    }
    const isOldPathInNewPath = await window.api.isPathInside(appInfo.appDataPath, newAppDataPath)
    if (isOldPathInNewPath) {
      toast.error(t('settings.data.app_data.select_error_same_path'))
      return
    }

    // check new app data path is not in app install path
    const isInInstallPath = await window.api.isPathInside(newAppDataPath, appInfo.installPath)
    if (isInInstallPath) {
      toast.error(t('settings.data.app_data.select_error_in_app_path'))
      return
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(newAppDataPath)
    if (!hasWritePermission) {
      toast.error(t('settings.data.app_data.select_error_write_permission'))
      return
    }

    const migrationTitle = (
      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>
    )
    const migrationClassName = 'migration-modal'
    void showMigrationConfirmModal(appInfo.appDataPath, newAppDataPath, migrationTitle, migrationClassName)
  }

  // 显示确认迁移的对话框
  const showMigrationConfirmModal = async (
    originalPath: string,
    newPath: string,
    title: React.ReactNode,
    className: string
  ) => {
    let shouldCopyData = !(await window.api.isNotEmptyDir(newPath))

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
            className="mr-2"
          />
          <MigrationPathLabel style={{ fontWeight: 'normal', fontSize: '14px' }}>
            {t('settings.data.app_data.copy_data_option')}
          </MigrationPathLabel>
        </MigrationPathRow>
      </div>
    )

    const confirmed = await popup.confirm({
      title,
      className,
      width: 'min(600px, 90vw)',
      style: { minHeight: '400px' },
      content: (
        <MigrationModalContent>
          <PathsContent />
          <CopyDataContent />
          <MigrationNotice>
            <p style={{ color: 'var(--color-warning)' }}>{t('settings.data.app_data.restart_notice')}</p>
            <p style={{ color: 'var(--color-foreground-muted)', marginTop: '8px' }}>
              {t('settings.data.app_data.copy_time_notice')}
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
      // Both "copy" and "switch-only" go through the same preboot
      // relocation protocol: write a `pending` request to BootConfig
      // and relaunch. The actual copy (if any) and path switch happen
      // in the preboot relocation gate on the next launch, when no
      // file in the old userData is locked.
      await window.api.setAppDataPath({ path: newPath, copyData: shouldCopyData })
      toast.info({ title: t('settings.data.app_data.restart_notice'), timeout: 3000 })
      setTimeoutTimer(
        'showMigrationConfirmModal',
        () => {
          void window.api.application.relaunch()
        },
        500
      )
    } catch (error) {
      toast.error({
        title: t('settings.data.app_data.path_change_failed') + ': ' + error,
        timeout: 5000
      })
    }
  }

  const handleOpenPath = (path?: string) => {
    if (!path) return
    if (path?.endsWith('log')) {
      const dirPath = path.split(/[/\\]/).slice(0, -1).join('/')
      void window.api.openPath(dirPath)
    } else {
      void window.api.openPath(path)
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

  const onSkipBackupFilesChange = (value: boolean) => {
    void setSkipBackupFile(value)
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.title')}</SettingTitle>
        <SettingDivider />
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
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.export_to_phone.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.export_to_phone.lan.title')}</SettingRowTitle>
          <RowFlex className="justify-between gap-1.25">
            <Button onClick={() => LanTransferPopup.show()} variant="outline">
              <Wifi size={14} />
              {t('settings.data.export_to_phone.lan.button')}
            </Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.export_to_phone.file.title')}</SettingRowTitle>
          <RowFlex className="justify-between gap-1.25">
            <Button onClick={() => BackupPopup.show('lan-transfer')} variant="outline">
              <FolderInput size={14} />
              {t('settings.data.export_to_phone.file.button')}
            </Button>
          </RowFlex>
        </SettingRow>
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
          <SettingRowTitle>{t('settings.general.reset.title')}</SettingRowTitle>
          <RowFlex className="gap-1.25">
            <Button onClick={reset} variant="destructive">
              {t('settings.general.reset.title')}
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
