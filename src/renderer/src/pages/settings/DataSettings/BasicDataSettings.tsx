import { LoadingOutlined, WifiOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import LanTransferPopup from '@renderer/components/Popups/LanTransferPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { reset } from '@renderer/services/BackupService'
import type { AppInfo } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { occupiedDirs } from '@shared/config/constant'
import { Button, Progress, Tooltip, Typography } from 'antd'
import { FolderInput, FolderOpen, FolderOutput, SaveIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('BasicDataSettings')

const BasicDataSettings: React.FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheSize, setCacheSize] = useState<string>('')
  const knowledgeFilesSize = 0
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const [skipBackupFile, setSkipBackupFile] = usePreference('data.backup.general.skip_backup_file')

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

    // check new app data path is root path
    const pathParts = newAppDataPath.split(/[/\\]/).filter((part: string) => part !== '')
    if (pathParts.length <= 1) {
      window.toast.error(t('settings.data.app_data.select_error_root_path'))
      return
    }

    // check new app data path is not in old app data path
    const isInOldPath = await window.api.isPathInside(newAppDataPath, appInfo.appDataPath)
    if (isInOldPath) {
      window.toast.error(t('settings.data.app_data.select_error_same_path'))
      return
    }

    // check new app data path is not in app install path
    const isInInstallPath = await window.api.isPathInside(newAppDataPath, appInfo.installPath)
    if (isInInstallPath) {
      window.toast.error(t('settings.data.app_data.select_error_in_app_path'))
      return
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(newAppDataPath)
    if (!hasWritePermission) {
      window.toast.error(t('settings.data.app_data.select_error_write_permission'))
      return
    }

    const migrationTitle = (
      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>
    )
    const migrationClassName = 'migration-modal'
    void showMigrationConfirmModal(appInfo.appDataPath, newAppDataPath, migrationTitle, migrationClassName)
  }

  const doubleConfirmModalBeforeCopyData = (newPath: string) => {
    window.modal.confirm({
      title: t('settings.data.app_data.select_not_empty_dir'),
      content: t('settings.data.app_data.select_not_empty_dir_content'),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        window.toast.info({
          title: t('settings.data.app_data.restart_notice'),
          timeout: 2000
        })
        setTimeoutTimer(
          'doubleConfirmModalBeforeCopyData',
          () => {
            void window.api.application.relaunch({
              args: ['--new-data-path=' + newPath]
            })
          },
          500
        )
      }
    })
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

    window.modal.confirm({
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
            <p style={{ color: 'var(--color-text-3)', marginTop: '8px' }}>
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
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          if (shouldCopyData) {
            if (await window.api.isNotEmptyDir(newPath)) {
              doubleConfirmModalBeforeCopyData(newPath)
              return
            }

            window.toast.info({
              title: t('settings.data.app_data.restart_notice'),
              timeout: 3000
            })
            setTimeoutTimer(
              'showMigrationConfirmModal_1',
              () => {
                void window.api.application.relaunch({
                  args: ['--new-data-path=' + newPath]
                })
              },
              500
            )
            return
          }
          await window.api.setAppDataPath(newPath)
          window.toast.success(t('settings.data.app_data.path_changed_without_copy'))

          setAppInfo(await window.api.getAppInfo())

          setTimeoutTimer(
            'showMigrationConfirmModal_2',
            () => {
              window.toast.success(t('settings.data.app_data.select_success'))
              void window.api.application.relaunch()
            },
            500
          )
        } catch (error) {
          window.toast.error({
            title: t('settings.data.app_data.path_change_failed') + ': ' + error,
            timeout: 5000
          })
        }
      }
    })
  }

  // 显示进度模态框
  const showProgressModal = (title: React.ReactNode, className: string, PathsContent: React.FC) => {
    let currentProgress = 0
    let progressInterval: NodeJS.Timeout | null = null

    const loadingModal = window.modal.info({
      title,
      className,
      width: 'min(600px, 90vw)',
      style: { minHeight: '400px' },
      icon: <LoadingOutlined style={{ fontSize: 18 }} />,
      content: (
        <MigrationModalContent>
          <PathsContent />
          <MigrationNotice>
            <p>{t('settings.data.app_data.copying')}</p>
            <div style={{ marginTop: '12px' }}>
              <Progress percent={currentProgress} status="active" strokeWidth={8} />
            </div>
            <p style={{ color: 'var(--color-warning)', marginTop: '12px', fontSize: '13px' }}>
              {t('settings.data.app_data.copying_warning')}
            </p>
          </MigrationNotice>
        </MigrationModalContent>
      ),
      centered: true,
      closable: false,
      maskClosable: false,
      okButtonProps: { style: { display: 'none' } }
    })

    const updateProgress = (progress: number, status: 'active' | 'success' = 'active') => {
      loadingModal.update({
        title,
        content: (
          <MigrationModalContent>
            <PathsContent />
            <MigrationNotice>
              <p>{t('settings.data.app_data.copying')}</p>
              <div style={{ marginTop: '12px' }}>
                <Progress percent={Math.round(progress)} status={status} strokeWidth={8} />
              </div>
              <p style={{ color: 'var(--color-warning)', marginTop: '12px', fontSize: '13px' }}>
                {t('settings.data.app_data.copying_warning')}
              </p>
            </MigrationNotice>
          </MigrationModalContent>
        )
      })
    }

    progressInterval = setInterval(() => {
      if (currentProgress < 95) {
        currentProgress += Math.random() * 5 + 1
        if (currentProgress > 95) currentProgress = 95
        updateProgress(currentProgress)
      }
    }, 500)

    return { loadingModal, progressInterval, updateProgress }
  }

  // 开始迁移数据
  const startMigration = async (
    originalPath: string,
    newPath: string,
    progressInterval: NodeJS.Timeout | null,
    updateProgress: (progress: number, status?: 'active' | 'success') => void,
    loadingModal: { destroy: () => void }
  ): Promise<void> => {
    await window.api.flushAppData()

    await new Promise((resolve) => setTimeoutTimer('startMigration_1', resolve, 2000))

    const copyResult = await window.api.copy(
      originalPath,
      newPath,
      occupiedDirs.map((dir) => originalPath + '/' + dir)
    )

    if (progressInterval) {
      clearInterval(progressInterval)
    }

    updateProgress(100, 'success')

    if (!copyResult.success) {
      await new Promise<void>((resolve) => {
        setTimeoutTimer(
          'startMigration_2',
          () => {
            loadingModal.destroy()
            window.toast.error({
              title: t('settings.data.app_data.copy_failed') + ': ' + copyResult.error,
              timeout: 5000
            })
            resolve()
          },
          500
        )
      })

      throw new Error(copyResult.error || 'Unknown error during copy')
    }

    await window.api.setAppDataPath(newPath)

    await new Promise((resolve) => setTimeoutTimer('startMigration_3', resolve, 500))

    loadingModal.destroy()

    window.toast.success({
      title: t('settings.data.app_data.copy_success'),
      timeout: 2000
    })
  }

  useEffect(() => {
    const handleDataMigration = async () => {
      const newDataPath = await window.api.getDataPathFromArgs()
      if (!newDataPath) return

      const originalPath = (await window.api.getAppInfo())?.appDataPath
      if (!originalPath) return

      const title = (
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>
      )
      const className = 'migration-modal'

      const PathsContent = () => (
        <div>
          <MigrationPathRow>
            <MigrationPathLabel>{t('settings.data.app_data.original_path')}:</MigrationPathLabel>
            <MigrationPathValue>{originalPath}</MigrationPathValue>
          </MigrationPathRow>
          <MigrationPathRow style={{ marginTop: '16px' }}>
            <MigrationPathLabel>{t('settings.data.app_data.new_path')}:</MigrationPathLabel>
            <MigrationPathValue>{newDataPath}</MigrationPathValue>
          </MigrationPathRow>
        </div>
      )

      const { loadingModal, progressInterval, updateProgress } = showProgressModal(title, className, PathsContent)
      const holdId = await window.api.application.preventQuit(t('settings.data.app_data.stop_quit_app_reason'))
      try {
        await startMigration(originalPath, newDataPath, progressInterval, updateProgress, loadingModal)

        setAppInfo(await window.api.getAppInfo())

        setTimeoutTimer(
          'handleDataMigration',
          () => {
            window.toast.success(t('settings.data.app_data.select_success'))
            void window.api.application.allowQuit(holdId)
            void window.api.application.relaunch({
              args: ['--user-data-dir=' + newDataPath]
            })
          },
          1000
        )
      } catch (error) {
        void window.api.application.allowQuit(holdId)
        window.toast.error({
          title: t('settings.data.app_data.copy_failed') + ': ' + error,
          timeout: 5000
        })
      } finally {
        if (progressInterval) {
          clearInterval(progressInterval)
        }
        loadingModal.destroy()
      }
    }

    void handleDataMigration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenPath = (path?: string) => {
    if (!path) return
    if (path?.endsWith('log')) {
      const dirPath = path.split(/[/\\]/).slice(0, -1).join('/')
      void window.api.openPath(dirPath)
    } else {
      void window.api.openPath(path)
    }
  }

  const handleClearCache = () => {
    window.modal.confirm({
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.confirm'),
      okText: t('settings.data.clear_cache.button'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        try {
          await window.api.clearCache()
          await window.api.trace.cleanLocalData()
          await window.api.getCacheSize().then(setCacheSize)
          window.toast.success(t('settings.data.clear_cache.success'))
        } catch (error) {
          window.toast.error(t('settings.data.clear_cache.error'))
        }
      }
    })
  }

  const handleRemoveAllFiles = () => {
    window.modal.confirm({
      centered: true,
      title: t('settings.data.app_knowledge.remove_all') + ` (${formatFileSize(knowledgeFilesSize)}) `,
      content: t('settings.data.app_knowledge.remove_all_confirm'),
      onOk: async () => {
        logger.warn('Legacy knowledge file cleanup is disabled after Knowledge V1 removal')
        window.toast.success(t('settings.data.app_knowledge.remove_all_success'))
      },
      okText: t('common.delete'),
      okButtonProps: {
        danger: true
      }
    })
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
          <RowFlex className="justify-between gap-[5px]">
            <Button onClick={() => BackupPopup.show()} icon={<SaveIcon size={14} />}>
              {t('settings.general.backup.button')}
            </Button>
            <Button onClick={RestorePopup.show} icon={<FolderOpen size={14} />}>
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
          <RowFlex className="justify-between gap-[5px]">
            <Button onClick={LanTransferPopup.show} icon={<WifiOutlined size={14} />}>
              {t('settings.data.export_to_phone.lan.button')}
            </Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.export_to_phone.file.title')}</SettingRowTitle>
          <RowFlex className="justify-between gap-[5px]">
            <Button onClick={() => BackupPopup.show('lan-transfer')} icon={<FolderInput size={14} />}>
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
            <PathText style={{ color: 'var(--color-text-3)' }} onClick={() => handleOpenPath(appInfo?.appDataPath)}>
              {appInfo?.appDataPath}
            </PathText>
            <Tooltip title={t('settings.data.app_data.select')}>
              <FolderOutput onClick={handleSelectAppDataPath} style={{ cursor: 'pointer' }} size={16} />
            </Tooltip>
            <RowFlex className="ml-2 gap-[5px]">
              <Button onClick={() => handleOpenPath(appInfo?.appDataPath)}>{t('settings.data.app_data.open')}</Button>
            </RowFlex>
          </PathRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_logs.label')}</SettingRowTitle>
          <PathRow>
            <PathText style={{ color: 'var(--color-text-3)' }} onClick={() => handleOpenPath(appInfo?.logsPath)}>
              {appInfo?.logsPath}
            </PathText>
            <RowFlex className="ml-2 gap-[5px]">
              <Button onClick={() => handleOpenPath(appInfo?.logsPath)}>{t('settings.data.app_logs.button')}</Button>
            </RowFlex>
          </PathRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.app_knowledge.label')}</SettingRowTitle>
          <RowFlex className="items-center gap-[5px]">
            <Button onClick={handleRemoveAllFiles}>{t('settings.data.app_knowledge.button.delete')}</Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            {t('settings.data.clear_cache.title')}
            {cacheSize && <CacheText>({cacheSize}MB)</CacheText>}
          </SettingRowTitle>
          <RowFlex className="gap-[5px]">
            <Button onClick={handleClearCache}>{t('settings.data.clear_cache.button')}</Button>
          </RowFlex>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.reset.title')}</SettingRowTitle>
          <RowFlex className="gap-[5px]">
            <Button onClick={reset} danger>
              {t('settings.general.reset.title')}
            </Button>
          </RowFlex>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

const CacheText = styled(Typography.Text)`
  color: var(--color-text-3);
  font-size: 12px;
  margin-left: 5px;
  line-height: 16px;
  display: inline-block;
  vertical-align: middle;
  text-align: left;
`

const PathText = styled(Typography.Text)`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
  text-align: right;
  margin-left: 5px;
  cursor: pointer
`

const PathRow = styled(RowFlex)`
  min-width: 0;
  flex: 1;
  width: 0;
  align-items: center;
  gap: 5px;
`

// Add styled components for migration modal
const MigrationModalContent = styled.div`
  padding: 20px 0 10px;
  display: flex;
  flex-direction: column;
`

const MigrationNotice = styled.div`
  margin-top: 24px;
  font-size: 14px;
`

const MigrationPathRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`

const MigrationPathLabel = styled.div`
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text-1);
`

const MigrationPathValue = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  background-color: var(--color-background-soft);
  padding: 8px 12px;
  border-radius: 4px;
  word-break: break-all;
  border: 1px solid var(--color-border);
`

export default BasicDataSettings
