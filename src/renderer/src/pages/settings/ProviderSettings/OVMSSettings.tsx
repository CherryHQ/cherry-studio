import { VStack } from '@renderer/components/Layout'
import { Alert, Button } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingSubtitle } from '..'

const OVMSSettings: FC = () => {
  const { t } = useTranslation()

  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')
  const [isInstallingOvms, setIsInstallingOvms] = useState(false)
  const [isRunningOvms, setIsRunningOvms] = useState(false)
  const [isStoppingOvms, setIsStoppingOvms] = useState(false)

  useEffect(() => {
    const checkStatus = async () => {
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
    }
    checkStatus()
  }, [])

  const installOvms = async () => {
    try {
      setIsInstallingOvms(true)
      await window.api.installOvmsBinary()
      // 安装成功后重新检查状态
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsInstallingOvms(false)
    } catch (error: any) {
      const errCodeMsg = {
        '100': t('ovms.failed.install_code_100'),
        '101': t('ovms.failed.install_code_101'),
        '102': t('ovms.failed.install_code_102'),
        '103': t('ovms.failed.install_code_103'),
        '104': t('ovms.failed.install_code_104'),
        '105': t('ovms.failed.install_code_105'),
        '106': t('ovms.failed.install_code_106'),
        '110': t('ovms.failed.install_code_110')
      }
      const match = error.message.match(/code (\d+)/)
      const code = match ? match[1] : 'unknown'
      const errorMsg = errCodeMsg[code as keyof typeof errCodeMsg] || error.message

      window.toast.error(t('ovms.failed.install') + errorMsg)
      setIsInstallingOvms(false)
    }
  }

  const runOvms = async () => {
    try {
      setIsRunningOvms(true)
      await window.api.ovms.runOvms()
      // 运行成功后重新检查状态
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsRunningOvms(false)
    } catch (error: any) {
      window.toast.error(t('ovms.failed.run') + error.message)
      setIsRunningOvms(false)
    }
  }

  const stopOvms = async () => {
    try {
      setIsStoppingOvms(true)
      await window.api.ovms.stopOvms()
      // 停止成功后重新检查状态
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsStoppingOvms(false)
    } catch (error: any) {
      window.toast.error(t('ovms.failed.stop') + error.message)
      setIsStoppingOvms(false)
    }
  }

  const getAlertType = () => {
    switch (ovmsStatus) {
      case 'running':
        return 'success'
      case 'not-running':
        return 'warning'
      case 'not-installed':
        return 'error'
      default:
        return 'warning'
    }
  }

  const getStatusMessage = () => {
    switch (ovmsStatus) {
      case 'running':
        return t('ovms.status.running')
      case 'not-running':
        return t('ovms.status.not_running')
      case 'not-installed':
        return t('ovms.status.not_installed')
      default:
        return t('ovms.status.unknown')
    }
  }

  return (
    <>
      <Alert
        type={getAlertType()}
        banner
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <VStack>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>{getStatusMessage()}</SettingSubtitle>
              {ovmsStatus === 'not-installed' && (
                <Button
                  type="primary"
                  onClick={installOvms}
                  loading={isInstallingOvms}
                  disabled={isInstallingOvms}
                  size="small">
                  {isInstallingOvms ? t('ovms.action.installing') : t('ovms.action.install')}
                </Button>
              )}
              {ovmsStatus === 'not-running' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    type="primary"
                    onClick={installOvms}
                    loading={isInstallingOvms}
                    disabled={isInstallingOvms || isRunningOvms}
                    size="small">
                    {isInstallingOvms ? t('ovms.action.installing') : t('ovms.action.reinstall')}
                  </Button>
                  <Button
                    type="primary"
                    onClick={runOvms}
                    loading={isRunningOvms}
                    disabled={isRunningOvms || isInstallingOvms}
                    size="small">
                    {isRunningOvms ? t('ovms.action.starting') : t('ovms.action.run')}
                  </Button>
                </div>
              )}
              {ovmsStatus === 'running' && (
                <Button
                  type="primary"
                  danger
                  onClick={stopOvms}
                  loading={isStoppingOvms}
                  disabled={isStoppingOvms}
                  size="small">
                  {isStoppingOvms ? t('ovms.action.stopping') : t('ovms.action.stop')}
                </Button>
              )}
            </SettingRow>
          </VStack>
        }
      />
      <Alert
        type="info"
        style={{ marginTop: 5 }}
        message={'Intel OVMS Guide:'}
        description={<div dangerouslySetInnerHTML={{ __html: t('ovms.description') }}></div>}
        showIcon
      />
    </>
  )
}

export default OVMSSettings
