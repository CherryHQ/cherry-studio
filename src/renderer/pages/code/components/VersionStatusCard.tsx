import { Button, Tooltip } from '@cherrystudio/ui'
import { BinaryInstallFailureRow, BinaryInstallingHint } from '@renderer/components/BinaryInstallErrorDialog'
import { CliIcon } from '@renderer/components/icons/CliIcon'
import { ArrowUpCircle, Download, ExternalLink, Play, Square, Trash2 } from 'lucide-react'
import { type FC, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { VersionStatus } from '../types'

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
  upgradeDisabled?: boolean
  canLaunch?: boolean
  launching?: boolean
  running?: boolean
  stopping?: boolean
  launchDisabledHint?: string
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
  upgradeDisabled,
  canLaunch,
  launching,
  running,
  stopping,
  launchDisabledHint,
  installError,
  onShowError
}) => {
  const { t } = useTranslation()
  const launchDisabledHintId = useId()
  const isInstalled = status.installed
  const canUpgrade = isInstalled && status.canUpgrade
  const removing = status.operation?.status === 'removing'
  const failedInstall = status.operation?.status === 'failed' && status.operation.action === 'install'
  const failedRemoval = status.operation?.status === 'failed' && status.operation.action === 'remove'
  const retryInstall =
    !failedRemoval &&
    !!onInstall &&
    (failedInstall || status.applicationStatus === 'broken' || status.applicationStatus === 'unknown')
  const canRemove = !!onRemove && (status.applicationStatus === 'applied' || status.applicationStatus === 'broken')
  const installing = isInstalling || isUpgrading
  const busy = installing || removing
  // "Up to date" must describe a genuinely current tool. A runnable-but-not-applied
  // mise state (broken/conflict/unknown) still reports installed with no upgrade, so
  // gate the badge on a clean application fact to avoid pairing it with Retry. A
  // bundled/system source carries no application fact and stays eligible.
  const cleanlyInstalled =
    isInstalled &&
    status.applicationStatus !== 'broken' &&
    status.applicationStatus !== 'conflict' &&
    status.applicationStatus !== 'unknown'
  const launchUnavailable = !running && !canLaunch

  const launchButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={launchUnavailable ? undefined : running ? onStop : onLaunch}
      disabled={busy || (running ? stopping : launching) || (launchUnavailable && !launchDisabledHint)}
      aria-disabled={(launchUnavailable && !!launchDisabledHint) || undefined}
      aria-describedby={launchUnavailable && launchDisabledHint ? launchDisabledHintId : undefined}
      className={
        running
          ? 'shrink-0 text-destructive hover:text-destructive'
          : `shrink-0 text-foreground${launchUnavailable ? 'cursor-not-allowed opacity-40' : ''}`
      }>
      {running && stopping ? (
        <>
          <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          {t('code.stop')}
        </>
      ) : running ? (
        <>
          <Square size={12} />
          {t('code.stop')}
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
  )

  return (
    <div className="rounded-lg border border-border-subtle bg-background px-4 py-5">
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
              cleanlyInstalled &&
              !canUpgrade && (
                <span className="shrink-0 rounded border border-success-border bg-success-subtle px-1.5 py-0.5 text-[10px] text-success-subtle-foreground">
                  {t('code.up_to_date')}
                </span>
              )
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
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
              disabled={busy || upgradeDisabled}
              className="shrink-0 gap-1 text-warning hover:bg-warning-subtle hover:text-warning-subtle-foreground">
              {isUpgrading ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-warning-border border-t-warning" />
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

          {canRemove && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              disabled={busy}
              aria-label={t('settings.dependencies.uninstall')}
              title={t('settings.dependencies.uninstall')}>
              {removing ? (
                <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          )}

          {retryInstall && (
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
            <>
              {launchDisabledHint && launchUnavailable ? (
                <Tooltip content={launchDisabledHint} placement="top" delay={300} sideOffset={6}>
                  {launchButton}
                </Tooltip>
              ) : (
                launchButton
              )}
              {launchDisabledHint && launchUnavailable ? (
                <span id={launchDisabledHintId} className="sr-only">
                  {launchDisabledHint}
                </span>
              ) : null}
            </>
          ) : (
            !failedRemoval &&
            !retryInstall && (
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
              {t('code.open_web_ui')}
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
