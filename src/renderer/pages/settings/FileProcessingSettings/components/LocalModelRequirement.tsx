import { Download, RefreshCw, SquareCheckBig, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { LocalModelDownloadProgress } from '@renderer/components/LocalModelDownloadProgress'
import { SettingHelpText, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { toast } from '@renderer/services/toast'
import type { LocalModelKind } from '@shared/data/presets/localModel'

const SUBTITLE_KEY = {
  embedding: 'settings.dependencies.localModels.embedding.subtitle',
  ocr: 'settings.dependencies.localModels.ocr.subtitle'
} as const satisfies Record<LocalModelKind, string>

type LocalModelRequirementProps = {
  model: LocalModelKind
  /** The processor's own description, shown either way. */
  description: string
  /** Commits a pending processor selection once this panel observes a ready model. */
  onReady?: () => Promise<void>
}

/**
 * Download state for a processor that needs a local model, rendered inside its
 * settings panel.
 *
 * This is the only reason such a processor is listed while its model is missing:
 * it used to be hidden outright, which left the download reachable only from a
 * settings page the user had no reason to visit. Mounted per processor rather
 * than per row so the status probe fires once, when the panel is open.
 */
export function LocalModelRequirement({ model, description, onReady }: LocalModelRequirementProps) {
  const { t } = useTranslation()
  const { status, percent, download, cancel } = useLocalModel(model)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    if (status === 'ready') {
      void onReadyRef.current?.()
    }
  }, [status])

  const handleDownload = async () => {
    try {
      await download()
    } catch {
      toast.error(t('settings.dependencies.localModels.notice.downloadFailed'))
    }
  }

  if (status === 'unsupported') {
    return null
  }

  const ready = status === 'ready'
  const downloading = status === 'downloading'

  return (
    <div className="flex flex-col gap-3 border-border-subtle border-t pt-4">
      <SettingRow className="items-start justify-start gap-2 py-1">
        <SquareCheckBig size={13} className={ready ? 'mt-0.5 shrink-0 text-success' : 'mt-0.5 shrink-0 opacity-0'} />
        <div className="min-w-0 flex-1">
          {ready ? (
            <SettingRowTitle className="text-success text-xs">
              {t('settings.tool.file_processing.processors.local_paddleocr.status.local')}
            </SettingRowTitle>
          ) : (
            <SettingRowTitle className="text-xs">{t(SUBTITLE_KEY[model])}</SettingRowTitle>
          )}
          <SettingHelpText className="mt-1 text-xs">{description}</SettingHelpText>
        </div>
      </SettingRow>

      {downloading ? (
        <div className="space-y-1.5">
          <LocalModelDownloadProgress percent={percent} />
          <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => void cancel()}>
            <X className="size-3.5" />
            {t('settings.dependencies.localModels.cancel')}
          </Button>
        </div>
      ) : null}

      {!ready && !downloading ? (
        <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => void handleDownload()}>
          {status === 'error' ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
          {t(status === 'error' ? 'common.retry' : 'settings.dependencies.localModels.download')}
        </Button>
      ) : null}
    </div>
  )
}
