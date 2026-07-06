import { Button } from '@cherrystudio/ui'
import { ArrowUpCircle, Download, ExternalLink, Play, Square, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { VersionStatus } from '../types/codeCli'
import { CLIIcon } from './CLIIcon'

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
  stopping
}) => {
  const { t } = useTranslation()
  const isInstalled = status.installed
  const canUpgrade = isInstalled && status.canUpgrade

  return (
    <div className="rounded-lg border border-border/40 bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        <CLIIcon id={toolId} size={28} className="size-7 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground text-sm">{toolName}</span>
            {isInstalled &&
              (canUpgrade ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onUpgrade}
                  disabled={isUpgrading}
                  className="h-auto min-h-0 shrink-0 gap-1 rounded px-1.5 py-0 text-[10px] text-warning hover:bg-warning/10 hover:text-warning">
                  <ArrowUpCircle size={10} />
                  {t('code.upgrade')}
                </Button>
              ) : (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                  {t('code.up_to_date')}
                </span>
              ))}
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
          {isInstalled && onRemove && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground/30 hover:text-destructive"
              onClick={onRemove}
              disabled={isInstalling || isUpgrading}
              aria-label={t('settings.dependencies.remove')}
              title={t('settings.dependencies.remove')}>
              <Trash2 className="size-3.5" />
            </Button>
          )}

          {isInstalled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={running ? onStop : onLaunch}
              disabled={running ? stopping : !canLaunch || launching}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onInstall}
              disabled={isInstalling}
              className="shrink-0 text-muted-foreground hover:border-border hover:text-foreground">
              {isInstalling ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  {t('code.installing')}
                </>
              ) : (
                <>
                  <Download size={12} />
                  {t('code.install')}
                </>
              )}
            </Button>
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
    </div>
  )
}
