import { FolderOpenOutlined, InfoCircleOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { HStack } from '@renderer/components/Layout'
import { S3BackupManager } from '@renderer/components/S3BackupManager'
import { S3BackupModal, useS3BackupModal } from '@renderer/components/S3Modals'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppSelector } from '@renderer/store'
import { Button, Input, Switch, Tooltip } from 'antd'
import dayjs from 'dayjs'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const S3Settings: FC = () => {
  const [, setS3AutoSync] = usePreference('data.backup.s3.auto_sync')
  const [s3Endpoint, setS3Endpoint] = usePreference('data.backup.s3.endpoint')
  const [s3Region, setS3Region] = usePreference('data.backup.s3.region')
  const [s3Bucket, setS3Bucket] = usePreference('data.backup.s3.bucket')
  const [s3AccessKeyId, setS3AccessKeyId] = usePreference('data.backup.s3.access_key_id')
  const [s3SecretAccessKey, setS3SecretAccessKey] = usePreference('data.backup.s3.secret_access_key')
  const [s3Root, setS3Root] = usePreference('data.backup.s3.root')
  const [s3SkipBackupFile, setS3SkipBackupFile] = usePreference('data.backup.s3.skip_backup_file')
  const [s3SyncInterval, setS3SyncInterval] = usePreference('data.backup.s3.sync_interval')
  const [s3MaxBackups, setS3MaxBackups] = usePreference('data.backup.s3.max_backups')

  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const { theme } = useTheme()
  const { t } = useTranslation()
  const { openMinapp } = useMinappPopup()

  const { s3Sync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = async (value: number) => {
    setS3SyncInterval(value)
    if (value === 0) {
      await setS3AutoSync(false)
      stopAutoSync('s3')
    } else {
      await setS3AutoSync(true)
      startAutoSync(false, 's3')
    }
  }

  const handleTitleClick = () => {
    openMinapp({
      id: 's3-help',
      name: 'S3 Compatible Storage Help',
      url: 'https://docs.cherry-ai.com/data-settings/s3-compatible'
    })
  }

  const onMaxBackupsChange = (value: number) => {
    setS3MaxBackups(value)
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setS3SkipBackupFile(value)
  }

  const renderSyncStatus = () => {
    if (!s3Endpoint) return null

    if (!s3Sync?.lastSyncTime && !s3Sync?.syncing && !s3Sync?.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.s3.syncStatus.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {s3Sync?.syncing && <SyncOutlined spin />}
        {!s3Sync?.syncing && s3Sync?.lastSyncError && (
          <Tooltip title={t('settings.data.s3.syncStatus.error', { message: s3Sync.lastSyncError })}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {s3Sync?.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.s3.syncStatus.lastSync', { time: dayjs(s3Sync.lastSyncTime).format('HH:mm:ss') })}
          </span>
        )}
      </HStack>
    )
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useS3BackupModal()

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.s3.title.label')}
        <Tooltip title={t('settings.data.s3.title.tooltip')} placement="right">
          <InfoCircleOutlined style={{ color: 'var(--color-text-2)', cursor: 'pointer' }} onClick={handleTitleClick} />
        </Tooltip>
      </SettingTitle>
      <SettingHelpText>{t('settings.data.s3.title.help')}</SettingHelpText>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.endpoint.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.endpoint.placeholder')}
          value={s3Endpoint}
          onChange={(e) => setS3Endpoint(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={(e) => setS3Endpoint(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.region.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.region.placeholder')}
          value={s3Region}
          onChange={(e) => setS3Region(e.target.value)}
          style={{ width: 250 }}
          onBlur={(e) => setS3Region(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.bucket.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.bucket.placeholder')}
          value={s3Bucket}
          onChange={(e) => setS3Bucket(e.target.value)}
          style={{ width: 250 }}
          onBlur={(e) => setS3Bucket(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.accessKeyId.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.accessKeyId.placeholder')}
          value={s3AccessKeyId}
          onChange={(e) => setS3AccessKeyId(e.target.value)}
          style={{ width: 250 }}
          onBlur={(e) => setS3AccessKeyId(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.secretAccessKey.label')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.s3.secretAccessKey.placeholder')}
          value={s3SecretAccessKey}
          onChange={(e) => setS3SecretAccessKey(e.target.value)}
          style={{ width: 250 }}
          onBlur={(e) => setS3SecretAccessKey(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.root.label')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.root.placeholder')}
          value={s3Root}
          onChange={(e) => setS3Root(e.target.value)}
          style={{ width: 250 }}
          onBlur={(e) => setS3Root(e.target.value)}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.backup.operation')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button
            onClick={showBackupModal}
            icon={<SaveOutlined />}
            loading={backuping}
            disabled={!s3Endpoint || !s3Region || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey}>
            {t('settings.data.s3.backup.button')}
          </Button>
          <Button
            onClick={showBackupManager}
            icon={<FolderOpenOutlined />}
            disabled={!s3Endpoint || !s3Region || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey}>
            {t('settings.data.s3.backup.manager.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.autoSync.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={s3SyncInterval}
          onChange={onSyncIntervalChange}
          disabled={!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey}
          options={[
            { label: t('settings.data.s3.autoSync.off'), value: 0 },
            { label: t('settings.data.s3.autoSync.minute', { count: 1 }), value: 1 },
            { label: t('settings.data.s3.autoSync.minute', { count: 5 }), value: 5 },
            { label: t('settings.data.s3.autoSync.minute', { count: 15 }), value: 15 },
            { label: t('settings.data.s3.autoSync.minute', { count: 30 }), value: 30 },
            { label: t('settings.data.s3.autoSync.hour', { count: 1 }), value: 60 },
            { label: t('settings.data.s3.autoSync.hour', { count: 2 }), value: 120 },
            { label: t('settings.data.s3.autoSync.hour', { count: 6 }), value: 360 },
            { label: t('settings.data.s3.autoSync.hour', { count: 12 }), value: 720 },
            { label: t('settings.data.s3.autoSync.hour', { count: 24 }), value: 1440 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.maxBackups.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={s3MaxBackups}
          onChange={onMaxBackupsChange}
          disabled={!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey}
          options={[
            { label: t('settings.data.s3.maxBackups.unlimited'), value: 0 },
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
        <SettingRowTitle>{t('settings.data.s3.skipBackupFile.label')}</SettingRowTitle>
        <Switch checked={s3SkipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.s3.skipBackupFile.help')}</SettingHelpText>
      </SettingRow>
      {s3SyncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.s3.syncStatus.label')}</SettingRowTitle>
            {renderSyncStatus()}
          </SettingRow>
        </>
      )}
      <>
        <S3BackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <S3BackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          s3Config={{
            endpoint: s3Endpoint,
            region: s3Region,
            bucket: s3Bucket,
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
            root: s3Root
          }}
        />
      </>
    </SettingGroup>
  )
}

export default S3Settings
