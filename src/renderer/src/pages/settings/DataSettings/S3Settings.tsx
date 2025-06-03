import { FolderOpenOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setS3AccessKeyId,
  setS3AutoSync,
  setS3Bucket,
  setS3Endpoint,
  setS3MaxBackups,
  setS3Region,
  setS3Root,
  setS3SecretAccessKey,
  setS3SkipBackupFile,
  setS3SyncInterval
} from '@renderer/store/settings'
import { Button, Input, Select, Switch, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

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
  const [syncInterval, setSyncInterval] = useState<number>(s3SyncIntervalInit)
  const [maxBackups, setMaxBackups] = useState<number>(s3MaxBackupsInit)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { s3Sync } = useAppSelector((state: any) => state.backup)

  // 事件处理
  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(setS3SyncInterval(value))
    dispatch(setS3AutoSync(value !== 0))
  }
  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(setS3MaxBackups(value))
  }
  const onSkipBackupFilesChange = (value: boolean) => {
    setSkipBackupFile(value)
    dispatch(setS3SkipBackupFile(value))
  }

  // 渲染同步状态
  const renderSyncStatus = () => {
    if (!endpoint) return null
    if (!s3Sync?.lastSyncTime && !s3Sync?.syncing && !s3Sync?.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>未同步</span>
    }
    return (
      <HStack gap="5px" alignItems="center">
        {s3Sync?.syncing && <SyncOutlined spin />}
        {!s3Sync?.syncing && s3Sync?.lastSyncError && (
          <Tooltip title={`同步错误: ${s3Sync.lastSyncError}`}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {s3Sync?.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            上次同步: {dayjs(s3Sync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </HStack>
    )
  }

  // 备份/恢复/管理操作（后续可接入弹窗/管理器）
  const handleBackup = async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error('请填写所有必需的 S3 配置项')
      return
    }
    try {
      // 这里假设 data 由主进程自动生成
      await window.api.backup.backupToS3('', {
        endpoint,
        region,
        bucket,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        root,
        skipBackupFile
      })
      window.message.success('备份成功')
    } catch (e: any) {
      window.message.error('备份失败: ' + e.message)
    }
  }
  const handleRestore = async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error('请填写所有必需的 S3 配置项')
      return
    }
    try {
      await window.api.backup.restoreFromS3({
        endpoint,
        region,
        bucket,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        root
      })
      window.message.success('恢复成功')
    } catch (e: any) {
      window.message.error('恢复失败: ' + e.message)
    }
  }
  const handleShowManager = async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error('请填写所有必需的 S3 配置项')
      return
    }
    try {
      const files = await window.api.backup.listS3Files({
        endpoint,
        region,
        bucket,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        root
      })
      window.modal.info({
        width: 600,
        title: 'S3 备份文件管理',
        content: (
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {files.length === 0 ? (
              <div>暂无备份文件</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>文件名</th>
                    <th style={{ textAlign: 'right', padding: 4 }}>大小</th>
                    <th style={{ textAlign: 'center', padding: 4 }}>修改时间</th>
                    <th style={{ textAlign: 'center', padding: 4 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f: any) => (
                    <tr key={f.fileName}>
                      <td style={{ padding: 4 }}>{f.fileName}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.size} 字节</td>
                      <td style={{ padding: 4, textAlign: 'center' }}>{f.modifiedTime}</td>
                      <td style={{ padding: 4, textAlign: 'center' }}>
                        <Button
                          size="small"
                          type="primary"
                          style={{ marginRight: 8 }}
                          onClick={async () => {
                            try {
                              await window.api.backup.restoreFromS3({
                                endpoint,
                                region,
                                bucket,
                                access_key_id: accessKeyId,
                                secret_access_key: secretAccessKey,
                                root,
                                fileName: f.fileName
                              })
                              window.message.success('恢复成功')
                            } catch (e: any) {
                              window.message.error('恢复失败: ' + e.message)
                            }
                          }}>
                          恢复
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={async () => {
                            await window.api.backup.deleteS3File(f.fileName, {
                              endpoint,
                              region,
                              bucket,
                              access_key_id: accessKeyId,
                              secret_access_key: secretAccessKey,
                              root
                            })
                            window.message.success('删除成功')
                          }}>
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })
    } catch (e: any) {
      window.message.error('获取备份列表失败: ' + e.message)
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>S3 兼容存储</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Endpoint</SettingRowTitle>
        <Input
          placeholder="S3 Endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={() => dispatch(setS3Endpoint(endpoint || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Region</SettingRowTitle>
        <Input
          placeholder="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Region(region || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Bucket</SettingRowTitle>
        <Input
          placeholder="Bucket"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Bucket(bucket || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Access Key ID</SettingRowTitle>
        <Input
          placeholder="Access Key ID"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3AccessKeyId(accessKeyId || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Secret Access Key</SettingRowTitle>
        <Input.Password
          placeholder="Secret Access Key"
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3SecretAccessKey(secretAccessKey || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>Root（可选）</SettingRowTitle>
        <Input
          placeholder="/basepath"
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(setS3Root(root || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>备份操作</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={handleBackup} icon={<SaveOutlined />}>
            立即备份
          </Button>
          <Button onClick={handleRestore} icon={<FolderOpenOutlined />}>
            恢复数据
          </Button>
          <Button onClick={handleShowManager} icon={<FolderOpenOutlined />}>
            管理备份
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>自动同步</SettingRowTitle>
        <Select value={syncInterval} onChange={onSyncIntervalChange} style={{ width: 120 }}>
          <Select.Option value={0}>关闭</Select.Option>
          <Select.Option value={1}>每 1 分钟</Select.Option>
          <Select.Option value={5}>每 5 分钟</Select.Option>
          <Select.Option value={15}>每 15 分钟</Select.Option>
          <Select.Option value={30}>每 30 分钟</Select.Option>
          <Select.Option value={60}>每 1 小时</Select.Option>
          <Select.Option value={120}>每 2 小时</Select.Option>
          <Select.Option value={360}>每 6 小时</Select.Option>
          <Select.Option value={720}>每 12 小时</Select.Option>
          <Select.Option value={1440}>每 24 小时</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>最大备份数</SettingRowTitle>
        <Select value={maxBackups} onChange={onMaxBackupsChange} style={{ width: 120 }}>
          <Select.Option value={0}>不限</Select.Option>
          <Select.Option value={1}>1</Select.Option>
          <Select.Option value={3}>3</Select.Option>
          <Select.Option value={5}>5</Select.Option>
          <Select.Option value={10}>10</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>跳过文件夹</SettingRowTitle>
        <Switch checked={skipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>同步状态</SettingRowTitle>
        {renderSyncStatus()}
      </SettingRow>
    </SettingGroup>
  )
}

export default S3Settings
