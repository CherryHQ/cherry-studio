import { Badge, Button, CircularProgress } from '@cherrystudio/ui'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { cn } from '@renderer/utils/style'
import type { LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'
import { Boxes, Download, RefreshCw, ScanText, Trash2, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DependencyCard from './DependencyCard'

const CARD_NOTICE_KEYS = {
  downloadFailed: 'settings.dependencies.localModels.notice.downloadFailed',
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
    notice: localModel.status === 'error' ? 'downloadFailed' : notice,
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
    <DependencyCard
      icon={icon}
      available={ready}
      title={name}
      titleAccessory={
        ready ? (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px] leading-4">
            {t('settings.dependencies.localModels.status.ready')}
          </Badge>
        ) : undefined
      }
      subtitle={subtitle}
      actions={
        ready ? (
          <Button
            variant="destructiveSubtle"
            size="icon-sm"
            onClick={onRemove}
            aria-label={t('settings.dependencies.localModels.remove')}>
            <Trash2 className="size-3.5" />
          </Button>
        ) : downloading ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="group relative size-7 shrink-0 rounded-full"
            onClick={onCancel}
            aria-label={t('settings.dependencies.localModels.cancel')}>
            <span
              role="progressbar"
              aria-label={t('settings.dependencies.localModels.status.downloading')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <CircularProgress value={percent} size={24} strokeWidth={2} />
            </span>
            <X className="relative size-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-28 shrink-0 gap-1 font-medium text-xs"
            onClick={onDownload}>
            {retrying ? <RefreshCw className="size-3.5 shrink-0" /> : <Download className="size-3.5 shrink-0" />}
            <span className="truncate">
              {t(retrying ? 'common.retry' : 'settings.dependencies.localModels.download')}
            </span>
          </Button>
        )
      }>
      {notice && (
        <p className={cn('mt-2 text-xs leading-4', notice === 'inUse' ? 'text-muted-foreground' : 'text-destructive')}>
          {t(CARD_NOTICE_KEYS[notice])}
        </p>
      )}
    </DependencyCard>
  )
}

/**
 * Local model download cards — embedding (transformers.js) and OCR
 * (PaddleOCR), each wired to its inference/download backend over IpcApi.
 */
const LocalModelsSection: FC = () => {
  const { t } = useTranslation()

  const embedding = useLocalModelCard('embedding')
  const ocr = useLocalModelCard('ocr')

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
      {unsupported ? (
        <div
          role="status"
          className="rounded-xl border border-border border-dashed bg-card/50 px-4 py-6 text-center text-muted-foreground text-xs leading-5">
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
