import { Button } from '@cherrystudio/ui'
import { useModels } from '@renderer/hooks/useModel'
import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { LocalModelStatus } from '@shared/data/presets/localModel'
import { Download, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalEmbeddingDownloadButtonProps {
  /** Select the local embedding model in the parent form once it is downloaded. */
  onSelected: (modelId: string) => void
}

/**
 * Inline entry point to download — then select — the optional local embedding
 * model, rendered only while the base has no embedding model set. The local
 * provider is hidden from the general model lists, so this button is the sole
 * way to pick it from the RAG config: downloading registers it in `user_model`
 * and selects it. Wraps the shared `local_model.*` IPC the settings cards use.
 */
const LocalEmbeddingDownloadButton = ({ onSelected }: LocalEmbeddingDownloadButtonProps) => {
  const { t } = useTranslation()
  const { refetch } = useModels({ enabled: true })
  const [status, setStatus] = useState<LocalModelStatus>('not_downloaded')
  const [percent, setPercent] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    ipcApi
      .request('local_model.get_status', { model: 'embedding' })
      .then((res) => {
        if (mountedRef.current) setStatus(res.status)
      })
      .catch(() => {
        // status probe is best-effort; keep the default 'not_downloaded'
      })
  }, [])

  useIpcOn('local_model.download_progress', (p) => {
    if (!mountedRef.current || p.model !== 'embedding') return
    setPercent(p.percent)
    if (p.status === 'ready') setStatus('ready')
    else if (p.status === 'error') setStatus('error')
  })

  // The model row only exists after the download registers it, so refetch the
  // list before selecting so the picker resolves its name instead of the raw id.
  const select = useCallback(async () => {
    await refetch()
    if (mountedRef.current) onSelected(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
  }, [refetch, onSelected])

  const download = useCallback(async () => {
    setStatus('downloading')
    setPercent(0)
    try {
      await ipcApi.request('local_model.download', { model: 'embedding' })
      await select()
    } catch {
      if (mountedRef.current) {
        setStatus('error')
        window.toast.error(t('knowledge.rag.download_local_embedding_failed'))
      }
    }
  }, [select, t])

  const cancel = useCallback(async () => {
    try {
      await ipcApi.request('local_model.cancel', { model: 'embedding' })
    } finally {
      if (mountedRef.current) {
        setStatus('not_downloaded')
        setPercent(0)
      }
    }
  }, [])

  if (status === 'downloading') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('common.cancel')}
        className="h-8 shrink-0 gap-1.5 px-2.5 font-normal text-xs"
        onClick={() => void cancel()}>
        <Loader2 className="size-3.5 animate-spin" />
        {percent}%
      </Button>
    )
  }

  if (status === 'ready') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5 px-2.5 font-normal text-xs"
        onClick={() => void select()}>
        {t('knowledge.rag.use_local_embedding')}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2.5 font-normal text-xs"
      onClick={() => void download()}>
      <Download className="size-3.5" />
      {t('knowledge.rag.download_local_embedding')}
    </Button>
  )
}

export default LocalEmbeddingDownloadButton
