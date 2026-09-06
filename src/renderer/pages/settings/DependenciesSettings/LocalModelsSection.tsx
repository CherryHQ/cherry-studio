import { Badge, Button, DescriptionSwitch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { LocalModelBundleId, LocalModelCapability, LocalModelStatus } from '@shared/data/presets/localModel'
import { Boxes, Download, RefreshCw, ScanText, Trash2, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('LocalModelsSection')

const CARD_NOTICE_KEYS = {
  downloadFailed: 'settings.dependencies.localModels.notice.downloadFailed',
  incompleteCache: 'settings.dependencies.localModels.notice.incompleteCache',
  removeFailed: 'settings.dependencies.localModels.notice.removeFailed',
  inUse: 'settings.dependencies.localModels.notice.inUse'
} as const

type CardNotice = keyof typeof CARD_NOTICE_KEYS

/** How each capability presents itself. A bundle for a new capability adds one entry here. */
const CAPABILITY_CARDS = {
  embedding: {
    icon: <Boxes className="size-5" />,
    nameKey: 'settings.dependencies.localModels.embedding.name',
    subtitleKey: 'settings.dependencies.localModels.embedding.subtitle'
  },
  ocr: {
    icon: <ScanText className="size-5" />,
    nameKey: 'settings.dependencies.localModels.ocr.name',
    subtitleKey: 'settings.dependencies.localModels.ocr.subtitle'
  }
} as const satisfies Record<LocalModelCapability, { icon: ReactNode; nameKey: string; subtitleKey: string }>

/**
 * Settings-specific notice state layered over the shared local-model lifecycle.
 */
function useLocalModelCard(id: LocalModelBundleId) {
  const localModel = useLocalModel(id)
  const [notice, setNotice] = useState<CardNotice | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const download = async () => {
    setNotice(null)
    try {
      await localModel.download()
    } catch {
      if (mountedRef.current) setNotice('downloadFailed')
    }
  }

  const remove = async () => {
    setNotice(null)
    try {
      const { removed } = await localModel.remove()
      if (!mountedRef.current) return
      if (!removed) setNotice('inUse')
    } catch {
      if (mountedRef.current) setNotice('removeFailed')
    }
  }

  return {
    ...localModel,
    notice:
      notice ??
      (localModel.status === 'error'
        ? localModel.errorCode === 'incomplete_cache'
          ? 'incompleteCache'
          : 'downloadFailed'
        : null),
    download,
    remove
  }
}

interface ModelCardProps {
  id: LocalModelBundleId
  capability: LocalModelCapability
  /** Lifted so the section can hide every card at once when the platform is unsupported. */
  onStatusChange: (id: LocalModelBundleId, status: LocalModelStatus) => void
}

const ModelCard: FC<ModelCardProps> = ({ id, capability, onStatusChange }) => {
  const { t } = useTranslation()
  const { status, percent, notice, download, cancel, remove } = useLocalModelCard(id)
  const { icon, nameKey, subtitleKey } = CAPABILITY_CARDS[capability]

  useEffect(() => {
    onStatusChange(id, status)
  }, [id, status, onStatusChange])
  const ready = status === 'ready'
  const downloading = status === 'downloading'
  const retrying = status === 'error'

  return (
    <div
      role="listitem"
      className="flex flex-col rounded-xl border border-border p-4 transition-colors duration-200 ease-in-out hover:border-border-strong"
      style={{ backgroundColor: 'var(--settings-group-background, var(--card))' }}>
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
            <span className="truncate text-foreground text-sm">{t(nameKey)}</span>
            {ready && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4">
                {t('settings.dependencies.localModels.status.ready')}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{t(subtitleKey)}</p>
        </div>
        {ready && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void remove()}
            aria-label={t('settings.dependencies.localModels.remove')}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {notice && (
        <p className={cn('mt-2 text-xs leading-4', notice === 'inUse' ? 'text-muted-foreground' : 'text-destructive')}>
          {t(CARD_NOTICE_KEYS[notice])}
        </p>
      )}

      {downloading && (
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{t('settings.dependencies.localModels.status.downloading')}</span>
            <span>{percent}%</span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="mt-3 border-border border-t pt-3">
          {downloading ? (
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => void cancel()}>
              <X className="size-3.5" />
              {t('settings.dependencies.localModels.cancel')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => void download()}>
              {retrying ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
              {t(retrying ? 'common.retry' : 'settings.dependencies.localModels.download')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

type ListedModel = { id: LocalModelBundleId; capability: LocalModelCapability }

/**
 * Local model download cards, one per installable bundle as reported by the registry.
 * Each is wired to its own download backend over IpcApi.
 */
const LocalModelsSection: FC = () => {
  const { t } = useTranslation()
  const [hardwareAccelerationEnabled, setHardwareAccelerationEnabled] = usePreference(
    'feature.local_model.hardware_acceleration.enabled'
  )
  const [accelerationSupported, setAccelerationSupported] = useState(false)
  const [models, setModels] = useState<ListedModel[]>([])
  const [statuses, setStatuses] = useState<Partial<Record<LocalModelBundleId, LocalModelStatus>>>({})

  const handleStatusChange = useCallback((id: LocalModelBundleId, status: LocalModelStatus) => {
    setStatuses((previous) => (previous[id] === status ? previous : { ...previous, [id]: status }))
  }, [])

  useEffect(() => {
    let mounted = true
    void ipcApi
      .request('local_model.get_acceleration_capability')
      .then(({ supported }) => {
        if (mounted) setAccelerationSupported(supported)
      })
      .catch((error) => logger.warn('Failed to detect local inference hardware acceleration', error as Error))
    void ipcApi
      .request('local_model.list')
      .then((result) => {
        if (mounted) setModels(result.models)
      })
      .catch((error) => logger.warn('Failed to list local models', error as Error))
    return () => {
      mounted = false
    }
  }, [])

  // The current models share onnxruntime, so they are unsupported together on Intel Mac.
  const unsupported = models.length > 0 && models.every((model) => statuses[model.id] === 'unsupported')

  return (
    <div className="min-w-0">
      <h2 className="font-semibold text-[15px] text-foreground leading-6">
        {t('settings.dependencies.localModels.title')}
      </h2>
      <p className="mt-1 mb-3 text-muted-foreground text-xs leading-5">
        {t('settings.dependencies.localModels.description')}
      </p>
      {accelerationSupported && !unsupported ? (
        <div className="mb-3 border-border border-y py-1">
          <DescriptionSwitch
            size="sm"
            label={t('settings.dependencies.localModels.acceleration.label')}
            description={t('settings.dependencies.localModels.acceleration.description')}
            checked={hardwareAccelerationEnabled}
            onCheckedChange={(enabled) => void setHardwareAccelerationEnabled(enabled)}
          />
        </div>
      ) : null}
      {unsupported ? (
        <div
          role="status"
          className="rounded-xl border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-xs leading-5"
          style={{
            backgroundColor: 'var(--settings-group-background, color-mix(in srgb, var(--card) 50%, transparent))'
          }}>
          {t('settings.dependencies.localModels.unsupported')}
        </div>
      ) : (
        <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {models.map((model) => (
            <ModelCard key={model.id} id={model.id} capability={model.capability} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </div>
  )
}

export default LocalModelsSection
