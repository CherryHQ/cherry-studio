import { FolderOpenOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { S3BackupManager } from '@renderer/components/S3BackupManager'
import { S3BackupModal, useS3BackupModal } from '@renderer/components/S3Modals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setS3AccessKeyId as _setS3AccessKeyId,
  setS3AutoSync,
  setS3Bucket as _setS3Bucket,
  setS3Endpoint as _setS3Endpoint,
  setS3MaxBackups as _setS3MaxBackups,
  setS3Region as _setS3Region,
  setS3Root as _setS3Root,
  setS3SecretAccessKey as _setS3SecretAccessKey,
  setS3SkipBackupFile as _setS3SkipBackupFile,
  setS3SyncInterval as _setS3SyncInterval
} from '@renderer/store/settings'
import { Button, Input, Select, Switch, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const S3Settings: FC = () => {
  const {
    s3Endpoint: s3EndpointInit,
    s3Region: s3RegionInit,
    s3Bucket: s3BucketInit,
    s3AccessKeyId: s3AccessKeyIdInit,
    s3SecretAccessKey: s3SecretAccessKeyInit,
    s3Root: s3RootInit,
    s3SyncInterval: s3SyncIntervalInit,
    s3MaxBackups: s3MaxBackupsInit,
    s3SkipBackupFile: s3SkipBackupFileInit
  } = useSettings()

  const [endpoint, setEndpoint] = useState<string | undefined>(s3EndpointInit)
  const [region, setRegion] = useState<string | undefined>(s3RegionInit)
  const [bucket, setBucket] = useState<string | undefined>(s3BucketInit)
  const [accessKeyId, setAccessKeyId] = useState<string | undefined>(s3AccessKeyIdInit)
  const [secretAccessKey, setSecretAccessKey] = useState<string | undefined>(s3SecretAccessKeyInit)
  const [root, setRoot] = useState<string | undefined>(s3RootInit)
  const [skipBackupFile, setSkipBackupFile] = useState<boolean>(s3SkipBackupFileInit)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const [syncInterval, setSyncInterval] = useState<number>(s3SyncIntervalInit)
  const [maxBackups, setMaxBackups] = useState<number>(s3MaxBackupsInit)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const { s3Sync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setS3SyncInterval(value))
    if (value === 0) {
      dispatch(setS3AutoSync(false))
      stopAutoSync()
    } else {
      dispatch(setS3AutoSync(true))
      startAutoSync()
    }
  }

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(_setS3MaxBackups(value))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setSkipBackupFile(value)
    dispatch(_setS3SkipBackupFile(value))
  }

  const renderSyncStatus = () => {
    if (!endpoint) return null

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
      <SettingTitle>{t('settings.data.s3.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.endpoint')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.endpoint.placeholder')}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={() => dispatch(_setS3Endpoint(endpoint || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.region')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.region.placeholder')}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setS3Region(region || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.bucket')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.bucket.placeholder')}
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setS3Bucket(bucket || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.accessKeyId')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.accessKeyId.placeholder')}
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setS3AccessKeyId(accessKeyId || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.secretAccessKey')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.s3.secretAccessKey.placeholder')}
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setS3SecretAccessKey(secretAccessKey || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.root')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.s3.root.placeholder')}
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setS3Root(root || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.backup.operation')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={showBackupModal} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.s3.backup.button')}
          </Button>
          <Button
            onClick={showBackupManager}
            icon={<FolderOpenOutlined />}
            disabled={!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey}>
            {t('settings.data.s3.backup.manager.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.autoSync')}</SettingRowTitle>
        <Select value={syncInterval} onChange={onSyncIntervalChange} disabled={!endpoint} style={{ width: 120 }}>
          <Select.Option value={0}>{t('settings.data.s3.autoSync.off')}</Select.Option>
          <Select.Option value={1}>{t('settings.data.s3.autoSync.minute', { count: 1 })}</Select.Option>
          <Select.Option value={5}>{t('settings.data.s3.autoSync.minute', { count: 5 })}</Select.Option>
          <Select.Option value={15}>{t('settings.data.s3.autoSync.minute', { count: 15 })}</Select.Option>
          <Select.Option value={30}>{t('settings.data.s3.autoSync.minute', { count: 30 })}</Select.Option>
          <Select.Option value={60}>{t('settings.data.s3.autoSync.hour', { count: 1 })}</Select.Option>
          <Select.Option value={120}>{t('settings.data.s3.autoSync.hour', { count: 2 })}</Select.Option>
          <Select.Option value={360}>{t('settings.data.s3.autoSync.hour', { count: 6 })}</Select.Option>
          <Select.Option value={720}>{t('settings.data.s3.autoSync.hour', { count: 12 })}</Select.Option>
          <Select.Option value={1440}>{t('settings.data.s3.autoSync.hour', { count: 24 })}</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.maxBackups')}</SettingRowTitle>
        <Select value={maxBackups} onChange={onMaxBackupsChange} disabled={!endpoint} style={{ width: 120 }}>
          <Select.Option value={0}>{t('settings.data.s3.maxBackups.unlimited')}</Select.Option>
          <Select.Option value={1}>1</Select.Option>
          <Select.Option value={3}>3</Select.Option>
          <Select.Option value={5}>5</Select.Option>
          <Select.Option value={10}>10</Select.Option>
          <Select.Option value={20}>20</Select.Option>
          <Select.Option value={50}>50</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.s3.skipBackupFile')}</SettingRowTitle>
        <Switch checked={skipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.s3.skipBackupFile.help')}</SettingHelpText>
      </SettingRow>
      {syncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.s3.syncStatus')}</SettingRowTitle>
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
            endpoint,
            region,
            bucket,
            access_key_id: accessKeyId,
            secret_access_key: secretAccessKey,
            root
          }}
        />
      </>
    </SettingGroup>
  )
}

export default S3Settings
