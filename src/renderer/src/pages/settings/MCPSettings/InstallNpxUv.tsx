import { Badge, Button } from '@cherrystudio/ui'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { cn } from '@renderer/utils'
import { useNavigate } from '@tanstack/react-router'
import { CircleAlert, CircleCheckBig, FolderOpen, Package } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'

interface Props {
  mini?: boolean
}

interface DependencyCardProps {
  actionLabel: string
  description: string
  installed: boolean
  installing: boolean
  name: string
  path: string | null
  onInstall: () => void
  onOpenPath: () => void
  t: (key: string) => string
}

const DependencyCard: FC<DependencyCardProps> = ({
  actionLabel,
  description,
  installed,
  installing,
  name,
  path,
  onInstall,
  onOpenPath,
  t
}) => (
  <div
    className={cn(
      'flex min-h-0 items-center gap-4 rounded-lg border border-border/80 bg-background px-3.5 py-3 transition-colors',
      !installed && 'border-warning/30'
    )}>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold text-foreground text-sm">{name}</div>
        {installed ? (
          <Badge
            variant="outline"
            className="gap-1 rounded-full border-primary/25 bg-primary/8 px-2 py-0.5 text-primary text-xs">
            <CircleCheckBig className="size-3.5" />
            {t('settings.skills.installed')}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 rounded-full border-warning/40 px-2 py-0.5 text-warning text-xs">
            <CircleAlert className="size-3.5" />
            {t('settings.mcp.install')}
          </Badge>
        )}
      </div>
      <div className="mt-1 text-muted-foreground text-xs leading-5">{description}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/75">
        <span className="truncate">
          {installed ? path || name : `${name} ${t('settings.mcp.missingDependencies')}`}
        </span>
        <button
          type="button"
          onClick={onOpenPath}
          disabled={!path}
          aria-label={t('settings.skills.directory')}
          className={cn(
            'inline-flex items-center transition-colors',
            path ? 'text-muted-foreground/80 hover:text-foreground' : 'cursor-default text-muted-foreground/40'
          )}>
          <FolderOpen className="size-3.5 shrink-0" />
        </button>
      </div>
    </div>

    {!installed && (
      <Button size="sm" className="shrink-0 rounded-lg shadow-none" onClick={onInstall} disabled={installing}>
        {installing ? t('settings.mcp.dependenciesInstalling') : actionLabel}
      </Button>
    )}
  </div>
)

const InstallNpxUv: FC<Props> = ({ mini = false }) => {
  const [isUvInstalled, setIsUvInstalled] = usePersistCache('feature.mcp.is_uv_installed')
  const [isBunInstalled, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')

  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvPath, setUvPath] = useState<string | null>(null)
  const [bunPath, setBunPath] = useState<string | null>(null)
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const checkBinariesTimerRef = useRef<NodeJS.Timeout>(undefined)

  // 清理定时器
  useEffect(() => {
    return () => {
      clearTimeout(checkBinariesTimerRef.current)
    }
  }, [])

  const checkBinaries = useCallback(async () => {
    try {
      const uvExists = await window.api.isBinaryExist('uv')
      const bunExists = await window.api.isBinaryExist('bun')
      const { uvPath, bunPath, dir } = await window.api.mcp.getInstallInfo()

      setIsUvInstalled(uvExists)
      setIsBunInstalled(bunExists)
      setUvPath(uvPath)
      setBunPath(bunPath)
      setBinariesDir(dir)
    } catch {
      // IPC failure — leave previous values unchanged
    }
  }, [setIsUvInstalled, setIsBunInstalled])

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsInstallingUv(false)
      setIsUvInstalled(true)
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
      setIsInstallingUv(false)
    }
    clearTimeout(checkBinariesTimerRef.current)
    checkBinariesTimerRef.current = setTimeout(checkBinaries, 1000)
  }

  const installBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      setIsInstallingBun(false)
      setIsBunInstalled(true)
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
      setIsInstallingBun(false)
    }
    clearTimeout(checkBinariesTimerRef.current)
    checkBinariesTimerRef.current = setTimeout(checkBinaries, 1000)
  }

  useEffect(() => {
    void checkBinaries()
  }, [checkBinaries])

  if (mini) {
    const installed = isUvInstalled && isBunInstalled
    if (installed) {
      return null
    }

    return (
      <Button
        className="nodrag h-9 rounded-full px-2.5 text-destructive shadow-none"
        variant="ghost"
        onClick={() => navigate({ to: '/settings/plugins' })}>
        <Package size={15} className="text-destructive" />
      </Button>
    )
  }

  const openBinariesDir = () => {
    if (binariesDir) {
      void window.api.openPath(binariesDir)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SettingTitle className="px-1 text-base">{t('settings.plugins.title')}</SettingTitle>

      <div className="flex flex-col gap-2">
        <DependencyCard
          actionLabel={t('settings.mcp.install')}
          description={t('settings.plugins.uvDescription')}
          installed={!!isUvInstalled}
          installing={isInstallingUv}
          name="UV"
          path={uvPath}
          onInstall={installUV}
          onOpenPath={openBinariesDir}
          t={t}
        />
        <DependencyCard
          actionLabel={t('settings.mcp.install')}
          description={t('settings.plugins.bunDescription')}
          installed={!!isBunInstalled}
          installing={isInstallingBun}
          name="Bun"
          path={bunPath}
          onInstall={installBun}
          onOpenPath={openBinariesDir}
          t={t}
        />
      </div>
    </div>
  )
}

export default InstallNpxUv
