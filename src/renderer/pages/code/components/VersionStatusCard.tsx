import { Button } from '@cherrystudio/ui'
import { BinaryInstallFailureRow, BinaryInstallingHint } from '@renderer/components/BinaryInstallErrorDialog'
import { ArrowUpCircle, Download, ExternalLink, Play, Square, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { VersionStatus } from '../types'
import { CliIcon } from './CliIcon'

interface VersionStatusCardProps {
  toolId: string
  toolName: string
  status: VersionStatus
  onInstall?: () => void
  onUpgrade?: () => void
  onRemove?: () => void
  onLaunch?: () => void
  onStop?: () => void
  onOpenDashboard?: () => void
  isInstalling?: boolean
  isUpgrading?: boolean
  canLaunch?: boolean
  launching?: boolean
  running?: boolean
  stopping?: boolean
  /** Failure message of the last install/upgrade attempt; renders a persistent failure row. */
  installError?: string
  onShowError?: () => void
}

export const VersionStatusCard: FC<VersionStatusCardProps> = ({
  toolId,
  toolName,
  status,
  onInstall,
  onUpgrade,
  onRemove,
  onLaunch,
  onStop,
  onOpenDashboard,
  isInstalling,
  isUpgrading,
  canLaunch,
  launching,
  running,
  stopping,
  installError,
  onShowError
}) => {
  const { t } = useTranslation()
  const isInstalled = status.installed
  const canUpgrade = isInstalled && status.canUpgrade
  const removing = status.operation?.status === 'removing'
  const failedInstall = status.operation?.status === 'failed' && status.operation.action === 'install'
  const failedRemoval = status.operation?.status === 'failed' && status.operation.action === 'remove'
  const retryUnownedInstall = failedInstall && !status.owned
  const installing = isInstalling || isUpgrading
  const busy = installing || removing

  return (
    <div className="rounded-lg border border-border/40 bg-background px-4 py-5">
      <div className="flex items-center gap-3">
        <CliIcon id={toolId} size={28} className="size-7 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground text-sm">{toolName}</span>
            {status.source === 'system' ? (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={status.systemPath}>
                {t('settings.dependencies.source.system')}
              </span>
            ) : (
              isInstalled &&
              !canUpgrade && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                  {t('code.up_to_date')}
                </span>
              )
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5 text-muted-foreground/60 text-xs">
            {isInstalled
              ? status.current && <span className="font-mono">v{status.current}</span>
              : status.latest && (
                  <>
                    <span>{t('code.latest')}</span>
                    <span className="font-mono">v{status.latest}</span>
                  </>
                )}
            {canUpgrade && (
              <>
                <ArrowUpCircle size={11} className="shrink-0 text-warning" />
                <span className="font-mono text-warning">v{status.latest}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isInstalled && canUpgrade && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onUpgrade}
              disabled={busy}
              className="shrink-0 gap-1 text-warning hover:bg-warning/10 hover:text-warning">
              {isUpgrading ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-warning/30 border-t-warning" />
                  {t('code.installing')}
                </>
              ) : (
                <>
                  <ArrowUpCircle size={12} />
                  {t('code.upgrade')}
                </>
              )}
            </Button>
          )}

          {status.owned && onRemove && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground/30 hover:text-destructive"
              onClick={onRemove}
              disabled={busy}
              aria-label={t('settings.dependencies.remove')}
              title={t('settings.dependencies.remove')}>
              {removing ? (
                <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          )}

          {retryUnownedInstall && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onInstall}
              disabled={busy}
              className="shrink-0 text-muted-foreground hover:border-border hover:text-foreground">
              <Download size={12} />
              {t('common.retry')}
            </Button>
          )}

          {isInstalled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={running ? onStop : onLaunch}
              disabled={busy || (running ? stopping : !canLaunch || launching)}
              className={running ? 'shrink-0 text-destructive hover:text-destructive' : 'shrink-0 text-foreground'}>
              {running && stopping ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  {t('openclaw.gateway.stop')}
                </>
              ) : running ? (
                <>
                  <Square size={12} />
                  {t('openclaw.gateway.stop')}
                </>
              ) : launching ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  {t('code.launching')}
                </>
              ) : (
                <>
                  <Play size={12} />
                  {t('code.launch.label')}
                </>
              )}
            </Button>
          ) : (
            !failedRemoval &&
            !retryUnownedInstall && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onInstall}
                disabled={busy}
                className="shrink-0 text-muted-foreground hover:border-border hover:text-foreground">
                {installing ? (
                  <>
                    <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                    {t('code.installing')}
                  </>
                ) : (
                  <>
                    <Download size={12} />
                    {installError ? t('common.retry') : t('code.install')}
                  </>
                )}
              </Button>
            )
          )}

          {isInstalled && running && onOpenDashboard && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenDashboard}
              className="shrink-0 text-foreground">
              <ExternalLink size={12} />
              {t('openclaw.gateway.open_dashboard')}
            </Button>
          )}
        </div>
      </div>

      {installing && <BinaryInstallingHint />}
      {installError && !busy && onShowError && (
        <BinaryInstallFailureRow error={installError} onShowError={onShowError} />
      )}
    </div>
  )
}
