import { Badge, Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { cn } from '@renderer/utils/style'
import type { LocalModelStatus } from '@shared/data/presets/localEmbedding'
import { Boxes, Download, ScanText, Trash2, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelCardProps {
  icon: ReactNode
  name: string
  subtitle: string
  status: LocalModelStatus
  percent: number
  /** Renders as a disabled placeholder (e.g. OCR before its backend lands). */
  comingSoon?: boolean
  comingSoonLabel?: string
  onDownload?: () => void
  onCancel?: () => void
  onRemove?: () => void
}

const ModelCard: FC<ModelCardProps> = ({
  icon,
  name,
  subtitle,
  status,
  percent,
  comingSoon,
  comingSoonLabel,
  onDownload,
  onCancel,
  onRemove
}) => {
  const { t } = useTranslation()
  const ready = status === 'ready'
  const downloading = status === 'downloading'

  return (
    <div
      role="listitem"
      className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-200 ease-in-out hover:border-border-hover">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            ready ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground text-sm">{name}</span>
            {ready && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4">
                {t('settings.plugins.localModels.status.ready')}
              </Badge>
            )}
            {comingSoon && (
              <Badge variant="outline" className="px-1.5 py-0 text-[11px] leading-4">
                {comingSoonLabel}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{subtitle}</p>
        </div>
        {ready && !comingSoon && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {downloading && (
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{t('settings.plugins.localModels.status.downloading')}</span>
            <span>{percent}%</span>
          </div>
        </div>
      )}

      {!comingSoon && !ready && (
        <div className="mt-3 border-border border-t pt-3">
          {downloading ? (
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 font-medium text-xs" onClick={onCancel}>
              <X className="size-3.5" />
              {t('settings.plugins.localModels.cancel')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 font-medium text-xs" onClick={onDownload}>
              <Download className="size-3.5" />
              {t('settings.plugins.localModels.download')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Local model download cards in the Environment Dependencies settings. The
 * embedding card is wired to the inference worker (download/progress/cancel/
 * remove via IpcApi); the OCR card is a disabled placeholder until its backend
 * lands.
 */
const LocalModelsSection: FC = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<LocalModelStatus>('not_downloaded')
  const [percent, setPercent] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await ipcApi.request('local_embedding.get_status')
      if (mountedRef.current) setStatus(res.status)
    } catch {
      // status probe is best-effort; leave the last known state
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useIpcOn('local_embedding.download_progress', (p) => {
    if (!mountedRef.current) return
    setPercent(p.percent)
    if (p.status === 'ready') setStatus('ready')
    else if (p.status === 'error') setStatus('error')
  })

  const download = async () => {
    setStatus('downloading')
    setPercent(0)
    try {
      await ipcApi.request('local_embedding.download')
      if (mountedRef.current) setStatus('ready')
    } catch {
      await refresh()
    }
  }

  const cancel = async () => {
    try {
      await ipcApi.request('local_embedding.cancel')
    } finally {
      if (mountedRef.current) {
        setStatus('not_downloaded')
        setPercent(0)
      }
    }
  }

  const remove = async () => {
    try {
      await ipcApi.request('local_embedding.remove')
    } finally {
      if (mountedRef.current) setStatus('not_downloaded')
    }
  }

  return (
    <div className="min-w-0">
      <h2 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.plugins.localModels.title')}</h2>
      <p className="mt-1 mb-3 text-muted-foreground text-xs leading-5">
        {t('settings.plugins.localModels.description')}
      </p>
      <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModelCard
          icon={<Boxes className="size-5" />}
          name={t('settings.plugins.localModels.embedding.name')}
          subtitle={t('settings.plugins.localModels.embedding.subtitle')}
          status={status}
          percent={percent}
          onDownload={download}
          onCancel={cancel}
          onRemove={remove}
        />
        <ModelCard
          icon={<ScanText className="size-5" />}
          name={t('settings.plugins.localModels.ocr.name')}
          subtitle={t('settings.plugins.localModels.ocr.subtitle')}
          status="not_downloaded"
          percent={0}
          comingSoon
          comingSoonLabel={t('settings.plugins.localModels.ocr.comingSoon')}
        />
      </div>
    </div>
  )
}

export default LocalModelsSection
