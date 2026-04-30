import { Button, ColFlex } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { ProviderSettingsSubtitle } from './components/ProviderSettingsPrimitives'
import { useOvmsSupport } from './hooks/useOvmsSupport'

const statusIcon = {
  running: CheckCircle2,
  'not-running': AlertTriangle,
  'not-installed': XCircle
} as const

const OVMSSettings: FC = () => {
  const { t } = useTranslation()
  const { isSupported } = useOvmsSupport()

  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')
  const [isInstallingOvms, setIsInstallingOvms] = useState(false)
  const [isRunningOvms, setIsRunningOvms] = useState(false)
  const [isStoppingOvms, setIsStoppingOvms] = useState(false)

  useEffect(() => {
    const checkStatus = async () => {
      if (!isSupported) return
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
    }
    void checkStatus()
  }, [isSupported])

  const installOvms = async () => {
    try {
      setIsInstallingOvms(true)
      await window.api.installOvmsBinary()
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsInstallingOvms(false)
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
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
      const match = errMsg.match(/code (\d+)/)
      const code = match ? match[1] : 'unknown'
      const errorMsg = code in errCodeMsg ? (errCodeMsg[code as keyof typeof errCodeMsg] ?? errMsg) : errMsg

      window.toast.error(t('ovms.failed.install') + errorMsg)
      setIsInstallingOvms(false)
    }
  }

  const runOvms = async () => {
    try {
      setIsRunningOvms(true)
      await window.api.ovms.runOvms()
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsRunningOvms(false)
    } catch (error: unknown) {
      window.toast.error(t('ovms.failed.run') + (error instanceof Error ? error.message : String(error)))
      setIsRunningOvms(false)
    }
  }

  const stopOvms = async () => {
    try {
      setIsStoppingOvms(true)
      await window.api.ovms.stopOvms()
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
      setIsStoppingOvms(false)
    } catch (error: unknown) {
      window.toast.error(t('ovms.failed.stop') + (error instanceof Error ? error.message : String(error)))
      setIsStoppingOvms(false)
    }
  }

  const bannerClasses = cn(
    'w-full rounded-[var(--list-item-border-radius)] border px-3 py-3 text-sm',
    ovmsStatus === 'running' && 'border-emerald-500/40 bg-emerald-500/10 text-foreground',
    ovmsStatus === 'not-running' && 'border-amber-500/40 bg-amber-500/10 text-foreground',
    ovmsStatus === 'not-installed' && 'border-destructive/40 bg-destructive/10 text-foreground'
  )

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

  const StatusIcon = statusIcon[ovmsStatus]

  return (
    <>
      <div className={bannerClasses} role="status">
        <ColFlex>
          <div className="flex min-h-6 w-full flex-row items-center justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <StatusIcon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  ovmsStatus === 'running' && 'text-emerald-600 dark:text-emerald-400',
                  ovmsStatus === 'not-running' && 'text-amber-600 dark:text-amber-400',
                  ovmsStatus === 'not-installed' && 'text-destructive'
                )}
                aria-hidden
              />
              <ProviderSettingsSubtitle className="mt-0 font-normal">{getStatusMessage()}</ProviderSettingsSubtitle>
            </div>
            {ovmsStatus === 'not-installed' && (
              <Button onClick={installOvms} disabled={isInstallingOvms} size="sm">
                {isInstallingOvms ? t('ovms.action.installing') : t('ovms.action.install')}
              </Button>
            )}
            {ovmsStatus === 'not-running' && (
              <div className="flex gap-2">
                <Button onClick={installOvms} disabled={isInstallingOvms || isRunningOvms} size="sm">
                  {isInstallingOvms ? t('ovms.action.installing') : t('ovms.action.reinstall')}
                </Button>
                <Button onClick={runOvms} disabled={isRunningOvms || isInstallingOvms} size="sm">
                  {isRunningOvms ? t('ovms.action.starting') : t('ovms.action.run')}
                </Button>
              </div>
            )}
            {ovmsStatus === 'running' && (
              <Button variant="destructive" onClick={stopOvms} disabled={isStoppingOvms} size="sm">
                {isStoppingOvms ? t('ovms.action.stopping') : t('ovms.action.stop')}
              </Button>
            )}
          </div>
        </ColFlex>
      </div>

      <div
        className="mt-1.5 flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-foreground text-sm"
        role="status">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{t('ovms.guide')}</p>
          <div>
            <Trans
              i18nKey="ovms.description"
              components={{
                div: <div />,
                dev: <div />,
                p: <p />,
                a: (
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="https://github.com/openvinotoolkit/model_server/blob/c55551763d02825829337b62c2dcef9339706f79/docs/deploying_server_baremetal.md"
                    rel="noreferrer"
                    target="_blank"
                  />
                )
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

export default OVMSSettings
