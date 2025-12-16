import { loggerService } from '@logger'
import { getBackupProgressLabel } from '@renderer/i18n/label'
import { backupWithOptions } from '@renderer/services/BackupService'
import store from '@renderer/store'
import { IpcChannel } from '@shared/IpcChannel'
import { Alert, Checkbox, Input, Modal, Progress, Radio, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('BackupPopup')

interface Props {
  resolve: (data: any) => void
}

type ProgressStageType =
  | 'preparing'
  | 'writing_data'
  | 'copying_files'
  | 'preparing_compression'
  | 'compressing'
  | 'encrypting'
  | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const [isRunning, setIsRunning] = useState(false)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [encryptBackup, setEncryptBackup] = useState(true)
  const [secretsAcknowledged, setSecretsAcknowledged] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const { t } = useTranslation()
  const skipBackupFile = store.getState().settings.skipBackupFile

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(IpcChannel.BackupProgress, (_, data: ProgressData) => {
      setProgressData(data)
    })

    return () => {
      removeListener()
    }
  }, [])

  const onOk = async () => {
    logger.debug(`skipBackupFile: ${skipBackupFile}`)
    setIsRunning(true)
    try {
      const completed = await backupWithOptions(skipBackupFile, {
        includeSecrets,
        passphrase: includeSecrets && encryptBackup ? passphrase : undefined
      })
      if (completed) {
        setOpen(false)
      }
    } catch (error) {
      logger.error('Backup failed:', error as Error)
      window.toast.error(t('message.backup.failed'))
      setProgressData(undefined)
    } finally {
      setIsRunning(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('backup.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return getBackupProgressLabel(progressData.stage)
  }

  BackupPopup.hide = onCancel

  const needsPassphrase = includeSecrets && encryptBackup
  const passphraseValid = !needsPassphrase || (passphrase.length > 0 && passphrase === confirmPassphrase)
  const canStart = !includeSecrets || (secretsAcknowledged && passphraseValid)

  const isProgressLocked = progressData ? progressData.stage !== 'completed' : false
  const isBusy = isRunning || isProgressLocked
  const okDisabled = isBusy || !canStart
  const cancelDisabled = isBusy

  return (
    <Modal
      title={t('backup.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okButtonProps={{ disabled: okDisabled }}
      cancelButtonProps={{ disabled: cancelDisabled }}
      okText={t('backup.confirm.button')}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!progressData && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>{t('backup.content')}</Typography.Paragraph>
          <Radio.Group
            value={includeSecrets ? 'with_secrets' : 'without_secrets'}
            onChange={(e) => {
              const nextInclude = e.target.value === 'with_secrets'
              setIncludeSecrets(nextInclude)
              if (!nextInclude) {
                setSecretsAcknowledged(false)
                setPassphrase('')
                setConfirmPassphrase('')
              }
            }}>
            <Space direction="vertical">
              <Radio value="without_secrets">{t('backup.options.without_secrets')}</Radio>
              <Radio value="with_secrets">{t('backup.options.with_secrets')}</Radio>
            </Space>
          </Radio.Group>

          {includeSecrets && (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Alert
                type="warning"
                showIcon
                message={t('backup.options.secrets_warning.title')}
                description={t('backup.options.secrets_warning.description')}
              />
              <Checkbox checked={secretsAcknowledged} onChange={(e) => setSecretsAcknowledged(e.target.checked)}>
                {t('backup.options.secrets_ack')}
              </Checkbox>
              <Checkbox checked={encryptBackup} onChange={(e) => setEncryptBackup(e.target.checked)}>
                {t('backup.options.encrypt_with_passphrase')}
              </Checkbox>

              {encryptBackup && (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Input.Password
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={t('backup.options.passphrase')}
                  />
                  <Input.Password
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder={t('backup.options.passphrase_confirm')}
                    status={confirmPassphrase.length > 0 && !passphraseValid ? 'error' : undefined}
                  />
                </Space>
              )}

              <Typography.Text type="secondary">{t('backup.options.path_tip')}</Typography.Text>
            </Space>
          )}
        </Space>
      )}
      {progressData && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={Math.floor(progressData.progress)} strokeColor="var(--color-primary)" />
          <div style={{ marginTop: 16 }}>{getProgressText()}</div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'BackupPopup'

export default class BackupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
