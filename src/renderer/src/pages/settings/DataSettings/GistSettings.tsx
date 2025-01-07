import { ExportOutlined, FolderOpenOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { backupToGist, restoreFromGist, startGistAutoSync, stopGistAutoSync } from '@renderer/services/GistService'
import { useAppDispatch } from '@renderer/store'
import {
  setGithubGistAutoSync,
  setGithubGistId as _setGithubGistId,
  setGithubGistSyncInterval as _setGithubSyncInterval,
  setGithubToken as _setGithubToken
} from '@renderer/store/settings'
import { Button, Input, Select, Typography } from 'antd'
import dayjs from 'dayjs'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingRow, SettingRowTitle, SettingTitle } from '..'

const { Link } = Typography

const GistSettings: FC = () => {
  const {
    githubToken: githubTokenFromStore,
    githubGistId: githubGistIdFromStore,
    githubGistSyncInterval: githubSyncIntervalFromStore = 0
  } = useSettings()

  const [githubToken, setGithubToken] = useState<string | undefined>(githubTokenFromStore)
  const [githubGistId, setGithubGistId] = useState<string | undefined>(githubGistIdFromStore)
  const [syncInterval, setSyncInterval] = useState<number>(githubSyncIntervalFromStore)

  const [backuping, setBackuping] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const { gistSync } = useRuntime()

  useEffect(() => {
    if (githubGistIdFromStore) {
      setGithubGistId(githubGistIdFromStore)
    }
  }, [githubGistIdFromStore])

  useEffect(() => {
    if (githubGistId === undefined && githubGistIdFromStore !== undefined) {
      setGithubGistId(githubGistIdFromStore)
    }
  }, [githubGistIdFromStore, githubGistId])

  const onBackup = async () => {
    if (!githubToken) {
      window.message.error({ content: t('settings.data.gist.invalid_github_token'), key: 'github-error' })
      return
    }
    setBackuping(true)
    await backupToGist()
    setBackuping(false)
  }

  const onRestore = async () => {
    if (!githubToken || !githubGistId) {
      window.message.error({ content: t('settings.data.gist.invalid_github_settings'), key: 'restore' })
      return
    }
    setRestoring(true)
    await restoreFromGist()
    setRestoring(false)
  }

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setGithubSyncInterval(value))
    if (value === 0) {
      dispatch(setGithubGistAutoSync(false))
      stopGistAutoSync()
    } else {
      dispatch(setGithubGistAutoSync(true))
      startGistAutoSync()
    }
  }

  const renderSyncStatus = () => {
    if (!githubToken || !githubGistId) return null

    if (!gistSync?.lastSyncTime && !gistSync?.syncing && !gistSync?.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.webdav.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {gistSync?.syncing && <SyncOutlined spin />}
        {gistSync?.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.webdav.lastSync')}: {dayjs(gistSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
        {gistSync?.lastSyncError && (
          <span style={{ color: 'var(--error-color)' }}>
            {t('settings.data.webdav.syncError')}: {gistSync.lastSyncError}
          </span>
        )}
      </HStack>
    )
  }

  return (
    <>
      <SettingTitle>{t('settings.data.gist.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          <HStack gap="5px" alignItems="center">
            {t('settings.data.gist.github_token')}
            <Link href="https://github.com/settings/tokens/new" target="_blank">
              <ExportOutlined style={{ fontSize: '12px', color: 'var(--color-text)' }} />
            </Link>
          </HStack>
        </SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.gist.github_token')}
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setGithubToken(githubToken || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          <HStack gap="5px" alignItems="center">
            {t('settings.data.gist.github_gist_id')}
            <Link href={`https://gist.github.com/${githubGistId}`} target="_blank">
              <ExportOutlined style={{ fontSize: '12px', color: 'var(--color-text)' }} />
            </Link>
          </HStack>
        </SettingRowTitle>
        <Input
          placeholder={t('settings.data.gist.github_gist_id')}
          value={githubGistId}
          onChange={(e) => setGithubGistId(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setGithubGistId(githubGistId || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={onBackup} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.gist.backup.button')}
          </Button>
          <Button onClick={onRestore} icon={<FolderOpenOutlined />} loading={restoring} disabled={!githubGistId}>
            {t('settings.data.gist.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.gist.github_auto_sync')}</SettingRowTitle>
        <Select
          value={syncInterval}
          onChange={onSyncIntervalChange}
          disabled={!githubToken || !githubGistId}
          style={{ width: 120 }}>
          <Select.Option value={0}>{t('settings.data.webdav.autoSync.off')}</Select.Option>
          <Select.Option value={1}>1 {t('settings.data.webdav.minutes')}</Select.Option>
          <Select.Option value={5}>5 {t('settings.data.webdav.minutes')}</Select.Option>
          <Select.Option value={15}>15 {t('settings.data.webdav.minutes')}</Select.Option>
          <Select.Option value={30}>30 {t('settings.data.webdav.minutes')}</Select.Option>
          <Select.Option value={60}>60 {t('settings.data.webdav.minutes')}</Select.Option>
          <Select.Option value={120}>120 {t('settings.data.webdav.minutes')}</Select.Option>
        </Select>
      </SettingRow>
      {gistSync && syncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.syncStatus')}</SettingRowTitle>
            {renderSyncStatus()}
          </SettingRow>
        </>
      )}
    </>
  )
}

export default GistSettings
