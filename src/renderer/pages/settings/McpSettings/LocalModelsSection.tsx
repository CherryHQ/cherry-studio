import { Badge, Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { cn } from '@renderer/utils/style'
import type { LocalModelStatus } from '@shared/data/presets/localEmbedding'
import type { IpcEventName } from '@shared/ipc/schemas'
import { Boxes, Download, ScanText, Trash2, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The four request thunks + progress event that drive one local-model card. */
interface LocalModelApi {
  getStatus: () => Promise<{ status: LocalModelStatus }>
  download: () => Promise<void>
  cancel: () => Promise<void>
  remove: () => Promise<void>
  progressEvent: Extract<IpcEventName, `${string}.download_progress`>
}

/**
 * Shared wiring for a downloadable local model: tracks status/percent, streams
 * progress, and exposes download/cancel/remove. The IPC routes differ per model
 * (embedding vs OCR), so callers pass pre-bound thunks; `apiRef` keeps `refresh`
 * stable while still reading the latest thunks.
 */
function useLocalModelCard(api: LocalModelApi) {
  const apiRef = useRef(api)
  apiRef.current = api
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
      const res = await apiRef.current.getStatus()
      if (mountedRef.current) setStatus(res.status)
    } catch {
      // status probe is best-effort; leave the last known state
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useIpcOn(api.progressEvent, (p) => {
    if (!mountedRef.current) return
    setPercent(p.percent)
    if (p.status === 'ready') setStatus('ready')
    else if (p.status === 'error') setStatus('error')
  })

  const download = async () => {
    setStatus('downloading')
    setPercent(0)
    try {
      await apiRef.current.download()
      if (mountedRef.current) setStatus('ready')
    } catch {
      await refresh()
    }
  }

  const cancel = async () => {
    try {
      await apiRef.current.cancel()
    } finally {
      if (mountedRef.current) {
        setStatus('not_downloaded')
        setPercent(0)
      }
    }
  }

  const remove = async () => {
    try {
      await apiRef.current.remove()
    } finally {
      if (mountedRef.current) setStatus('not_downloaded')
    }
  }

  return { status, percent, download, cancel, remove }
}

interface ModelCardProps {
  icon: ReactNode
  name: string
  subtitle: string
  status: LocalModelStatus
  percent: number
  onDownload: () => void
  onCancel: () => void
  onRemove: () => void
}

const ModelCard: FC<ModelCardProps> = ({ icon, name, subtitle, status, percent, onDownload, onCancel, onRemove }) => {
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
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{subtitle}</p>
        </div>
        {ready && (
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

      {!ready && (
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
 * Local model download cards in the Environment Dependencies settings — embedding
 * (transformers.js) and OCR (PaddleOCR), each wired to its inference/download
 * backend over IpcApi.
 */
const LocalModelsSection: FC = () => {
  const { t } = useTranslation()

  const embedding = useLocalModelCard({
    getStatus: () => ipcApi.request('local_embedding.get_status'),
    download: () => ipcApi.request('local_embedding.download'),
    cancel: () => ipcApi.request('local_embedding.cancel'),
    remove: () => ipcApi.request('local_embedding.remove'),
    progressEvent: 'local_embedding.download_progress'
  })

  const ocr = useLocalModelCard({
    getStatus: () => ipcApi.request('local_ocr.get_status'),
    download: () => ipcApi.request('local_ocr.download'),
    cancel: () => ipcApi.request('local_ocr.cancel'),
    remove: () => ipcApi.request('local_ocr.remove'),
    progressEvent: 'local_ocr.download_progress'
  })

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
          status={embedding.status}
          percent={embedding.percent}
          onDownload={embedding.download}
          onCancel={embedding.cancel}
          onRemove={embedding.remove}
        />
        <ModelCard
          icon={<ScanText className="size-5" />}
          name={t('settings.plugins.localModels.ocr.name')}
          subtitle={t('settings.plugins.localModels.ocr.subtitle')}
          status={ocr.status}
          percent={ocr.percent}
          onDownload={ocr.download}
          onCancel={ocr.cancel}
          onRemove={ocr.remove}
        />
      </div>
    </div>
  )
}

export default LocalModelsSection
