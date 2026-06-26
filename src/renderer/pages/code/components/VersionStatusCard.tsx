import { Badge, Button } from '@cherrystudio/ui'
import { Download, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { CLIIcon } from './CLIIcon'

export interface VersionStatus {
  installed: boolean
  current?: string
  latest?: string
  canUpgrade: boolean
}

interface VersionStatusCardProps {
  toolId: string
  toolName: string
  toolDescription?: string
  repoUrl?: string
  homepage?: string
  status: VersionStatus
  onInstall?: () => void
  onUpgrade?: () => void
  onRemove?: () => void
  isInstalling?: boolean
  isUpgrading?: boolean
}

export const VersionStatusCard: FC<VersionStatusCardProps> = ({
  toolId,
  toolName,
  toolDescription,
  repoUrl,
  homepage,
  status,
  onInstall,
  onUpgrade,
  onRemove,
  isInstalling,
  isUpgrading
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-200 ease-in-out hover:border-border-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CLIIcon id={toolId} size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-sm leading-5">{toolName}</span>
            </div>
            {status.installed && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {status.current && (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
                    v{status.current}
                  </Badge>
                )}
                {status.canUpgrade && (
                  <Badge
                    variant="outline"
                    className="gap-1 px-1.5 py-0 text-[11px] leading-4 text-warning border-warning/50">
                    {t('code.can_upgrade')} → v{status.latest}
                  </Badge>
                )}
              </div>
            )}
            {!status.installed && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] leading-4 text-muted-foreground">
                  {t('code.not_installed')}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {status.installed && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-foreground"
              onClick={onUpgrade}
              disabled={isUpgrading}
              title={t('code.upgrade')}>
              {isUpgrading ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-destructive"
              onClick={onRemove}
              disabled={isInstalling || isUpgrading}
              aria-label={t('settings.plugins.remove')}
              title={t('settings.plugins.remove')}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {toolDescription && (
        <p className="mt-2.5 line-clamp-2 text-muted-foreground text-xs leading-4" title={toolDescription}>
          {toolDescription}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        {repoUrl && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={() => void window.api.openWebsite(repoUrl)}>
            <ExternalLink className="size-3" />
            {repoUrl.replace('https://github.com/', '')}
          </button>
        )}
        {homepage && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={() => void window.api.openWebsite(homepage)}>
            <ExternalLink className="size-3" />
            {homepage.replace(/^https?:\/\//, '')}
          </button>
        )}
      </div>

      {!status.installed && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={isInstalling}
            loading={isInstalling}>
            {!isInstalling && <Download className="size-3.5" />}
            {isInstalling ? t('code.installing') : t('code.install')}
          </Button>
        </div>
      )}
    </div>
  )
}
