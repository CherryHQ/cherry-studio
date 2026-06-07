import { Badge, Button, HStack, VStack } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { cn } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { useNavigate } from '@tanstack/react-router'
import { Download, FolderOpen, PackageCheck, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EnvironmentDependenciesProps {
  mini?: boolean
}

interface EnvironmentDependencyItemProps {
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

const logger = loggerService.withContext('EnvironmentDependencies')

const EnvironmentDependencyItem: FC<EnvironmentDependencyItemProps> = ({
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
  <HStack
    gap={2}
    className="group min-h-13 w-full rounded-lg border border-border/60 bg-transparent px-2.5 py-2 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/55">
    <div
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl',
        installed ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-500'
      )}>
      <PackageCheck className="size-4" />
    </div>

    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <div className="truncate font-medium text-foreground text-sm leading-5">{name}</div>
      </div>

      <HStack gap={1} className="mt-0.5 min-w-0 text-muted-foreground text-xs leading-4">
        <span className="truncate">{description}</span>
        <button
          type="button"
          onClick={onOpenPath}
          disabled={!path}
          aria-label={t('settings.skills.directory')}
          className={cn(
            'inline-flex size-4.5 shrink-0 items-center justify-center rounded-md transition-colors',
            path ? 'text-muted-foreground/55 hover:bg-background hover:text-foreground' : 'hidden'
          )}>
          <FolderOpen className="size-3" />
        </button>
      </HStack>
    </div>

    <HStack gap={2} justify="end" className="min-w-[92px] shrink-0">
      {installed ? (
        <Badge className="border-transparent bg-success/10 px-1.5 py-0 font-medium text-[11px] text-success leading-4">
          {t('settings.skills.installed')}
        </Badge>
      ) : (
        <>
          <Badge className="border-transparent bg-muted px-1.5 py-0 font-medium text-[11px] text-muted-foreground leading-4">
            {t('settings.plugins.notInstalled')}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 font-medium text-xs shadow-none"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing ? t('settings.plugins.installing') : actionLabel}
          </Button>
        </>
      )}
    </HStack>
  </HStack>
)

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
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
  const hasShownCheckBinariesErrorRef = useRef(false)

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
      hasShownCheckBinariesErrorRef.current = false
    } catch (error) {
      logger.error('Failed to check MCP environment dependencies', error as Error)
      if (!hasShownCheckBinariesErrorRef.current) {
        hasShownCheckBinariesErrorRef.current = true
        window.toast.error(`${t('settings.mcp.installError')}: ${formatErrorMessage(error)}`)
      }
    }
  }, [setIsUvInstalled, setIsBunInstalled, t])

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsInstallingUv(false)
      setIsUvInstalled(true)
    } catch (error) {
      logger.error('Failed to install UV binary', error as Error)
      window.toast.error(`${t('settings.mcp.installError')}: ${formatErrorMessage(error)}`)
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
    } catch (error) {
      logger.error('Failed to install Bun binary', error as Error)
      window.toast.error(`${t('settings.mcp.installError')}: ${formatErrorMessage(error)}`)
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
        className="nodrag h-8 rounded-lg px-2 text-destructive shadow-none hover:text-destructive"
        variant="ghost"
        onClick={() => navigate({ to: '/settings/plugins' })}>
        <TriangleAlert size={14} />
      </Button>
    )
  }

  const openBinariesDir = () => {
    if (binariesDir) {
      void window.api.openPath(binariesDir)
    }
  }

  const dependenciesCount = 2

  return (
    <VStack gap={5}>
      <div className="min-w-0">
        <HStack gap={2} className="min-w-0">
          <h1 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.plugins.title')}</h1>
          <span className="text-muted-foreground/50 text-xs">{dependenciesCount}</span>
        </HStack>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('settings.plugins.description')}</p>
      </div>

      <VStack gap={2}>
        <EnvironmentDependencyItem
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
        <EnvironmentDependencyItem
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
      </VStack>
    </VStack>
  )
}

export default EnvironmentDependencies
