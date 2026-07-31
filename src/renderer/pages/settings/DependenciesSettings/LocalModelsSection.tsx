import { Boxes, Download, RefreshCw, ScanText, Trash2, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, DescriptionSwitch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'

const logger = loggerService.withContext('LocalModelsSection')

const CARD_NOTICE_KEYS = {
  downloadFailed: 'settings.dependencies.localModels.notice.downloadFailed',
  incompleteCache: 'settings.dependencies.localModels.notice.incompleteCache',
  removeFailed: 'settings.dependencies.localModels.notice.removeFailed',
  inUse: 'settings.dependencies.localModels.notice.inUse'
} as const

type CardNotice = keyof typeof CARD_NOTICE_KEYS

/**
 * Settings-specific notice state layered over the shared local-model lifecycle.
 */
function useLocalModelCard(model: LocalModelKind) {
  const localModel = useLocalModel(model)
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
      localModel.status === 'error'
        ? localModel.errorCode === 'incomplete_cache'
          ? 'incompleteCache'
          : 'downloadFailed'
        : notice,
    download,
    remove
  }
}

interface ModelCardProps {
  icon: ReactNode
  name: string
  subtitle: string
  status: LocalModelStatus
  percent: number
  notice: CardNotice | null
  onDownload: () => void
  onCancel: () => void
  onRemove: () => void
}

const ModelCard: FC<ModelCardProps> = ({
  icon,
  name,
  subtitle,
  status,
  percent,
  notice,
  onDownload,
  onCancel,
  onRemove
}) => {
  const { t } = useTranslation()
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
            <span className="truncate text-foreground text-sm">{name}</span>
            {ready && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4">
                {t('settings.dependencies.localModels.status.ready')}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{subtitle}</p>
        </div>
        {ready && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
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
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={onCancel}>
              <X className="size-3.5" />
              {t('settings.dependencies.localModels.cancel')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={onDownload}>
              {retrying ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
              {t(retrying ? 'common.retry' : 'settings.dependencies.localModels.download')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Local model download cards — embedding (transformers.js) and OCR
 * (PaddleOCR), each wired to its inference/download backend over IpcApi.
 */
const LocalModelsSection: FC = () => {
  const { t } = useTranslation()
  const [hardwareAccelerationEnabled, setHardwareAccelerationEnabled] = usePreference(
    'feature.local_model.hardware_acceleration.enabled'
  )
  const [accelerationSupported, setAccelerationSupported] = useState(false)

  const embedding = useLocalModelCard('embedding')
  const ocr = useLocalModelCard('ocr')

  useEffect(() => {
    let mounted = true
    void ipcApi
      .request('local_model.get_acceleration_capability')
      .then(({ supported }) => {
        if (mounted) setAccelerationSupported(supported)
      })
      .catch((error) => logger.warn('Failed to detect local inference hardware acceleration', error as Error))
    return () => {
      mounted = false
    }
  }, [])

  // Both models share the same inference runtime, so they're unsupported together
  // (e.g. Intel Mac — onnxruntime-node ships no darwin-x64 binding).
  const unsupported = embedding.status === 'unsupported' && ocr.status === 'unsupported'

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
          <ModelCard
            icon={<Boxes className="size-5" />}
            name={t('settings.dependencies.localModels.embedding.name')}
            subtitle={t('settings.dependencies.localModels.embedding.subtitle')}
            status={embedding.status}
            percent={embedding.percent}
            notice={embedding.notice}
            onDownload={embedding.download}
            onCancel={embedding.cancel}
            onRemove={embedding.remove}
          />
          <ModelCard
            icon={<ScanText className="size-5" />}
            name={t('settings.dependencies.localModels.ocr.name')}
            subtitle={t('settings.dependencies.localModels.ocr.subtitle')}
            status={ocr.status}
            percent={ocr.percent}
            notice={ocr.notice}
            onDownload={ocr.download}
            onCancel={ocr.cancel}
            onRemove={ocr.remove}
          />
        </div>
      )}
    </div>
  )
}

export default LocalModelsSection
