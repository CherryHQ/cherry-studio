import { useCallback, useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { WebviewHost } from '@renderer/components/WebviewHost'
import { ipcApi } from '@renderer/ipc'
import { MINI_APP_SCHEME } from '@shared/types/miniAppManifest'

const logger = loggerService.withContext('MiniAppPreviewPane')

const REFRESH_INTERVAL_MS = 5000

type PreviewSummary = Awaited<ReturnType<typeof loadPreviews>>[number]

async function loadPreviews(sessionId: string) {
  return ipcApi.request('mini_app.authoring.list', { sessionId })
}

/**
 * The agent-authored preview pane (issue #21646, stage 2): the renderer surface for
 * previews the session's `mini_app` tool opened, mounted by BOTH the home topics
 * right pane (keyed by topic id) and the agents page right pane (keyed by the
 * agent-session topic id) — previews are bound per session, so the same component
 * serves both.
 * It lists the session's previews,
 * prepares the selected one's partition exactly like an installed app
 * (`mini_app.runtime.prepare` — the webview may not attach before the protocol
 * handler and network policy are on the partition), and closes previews through
 * `mini_app.authoring.close`. Opening stays tool-only: there is deliberately no
 * "open" here, so no renderer path can spend an artifact token it never held.
 */
export const MiniAppPreviewPane: FC<{ sessionId: string; open: boolean }> = ({ sessionId, open }) => {
  const { t } = useTranslation()
  const [previews, setPreviews] = useState<PreviewSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preparedId, setPreparedId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await loadPreviews(sessionId)
      setPreviews(list)
      setSelectedId((current) =>
        current && list.some((p) => p.previewId === current) ? current : (list[0]?.previewId ?? null)
      )
    } catch (error) {
      logger.warn('Failed to list mini app previews', { error })
    }
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [open, refresh])

  const selected = previews.find((p) => p.previewId === selectedId) ?? null

  // Prepare AFTER selection changes; a replaced preview gets a new runtimeId and a
  // fresh prepare, and a failed one stays failed until its id leaves the list.
  const prepareSeq = useRef(0)
  useEffect(() => {
    if (!selected) {
      setPreparedId(null)
      setFailedId(null)
      return
    }
    const seq = ++prepareSeq.current
    ipcApi.request('mini_app.runtime.prepare', { appId: selected.runtimeId }).then(
      () => {
        if (prepareSeq.current === seq) {
          setPreparedId(selected.previewId)
          setFailedId(null)
        }
      },
      (error) => {
        logger.error('Failed to prepare mini app preview partition', { error })
        if (prepareSeq.current === seq) setFailedId(selected.previewId)
      }
    )
  }, [selected?.previewId, selected?.runtimeId, selected])

  const close = useCallback(
    async (previewId: string) => {
      try {
        await ipcApi.request('mini_app.authoring.close', { sessionId, previewId })
      } catch (error) {
        logger.warn('Failed to close mini app preview', { error })
      }
      await refresh()
    },
    [sessionId, refresh]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
        <span style={{ fontWeight: 600 }}>{t('miniApp.preview.pane.title')}</span>
        <button type="button" onClick={() => void refresh()} aria-label={t('miniApp.preview.pane.refresh')}>
          {t('miniApp.preview.pane.refresh')}
        </button>
      </div>
      {previews.length === 0 ? (
        <div style={{ padding: 8, opacity: 0.7 }}>{t('miniApp.preview.pane.empty')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 8px' }}>
            {previews.map((preview) => (
              <span
                key={preview.previewId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  border: preview.previewId === selectedId ? '1px solid currentColor' : '1px solid transparent'
                }}>
                <button type="button" onClick={() => setSelectedId(preview.previewId)}>
                  {`${preview.appId}@${preview.version}`}
                </button>
                <button
                  type="button"
                  aria-label={t('miniApp.preview.pane.close')}
                  onClick={() => void close(preview.previewId)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {selected &&
              (failedId === selected.previewId ? (
                <div style={{ padding: 8 }}>{t('miniApp.preview.pane.start_failed')}</div>
              ) : preparedId === selected.previewId ? (
                <WebviewHost
                  id={selected.previewId}
                  src={`${MINI_APP_SCHEME}://${selected.runtimeId}/${selected.entry}`}
                  partition={`persist:miniapp:${selected.runtimeId}`}
                  style={{ width: '100%', height: '100%' }}
                  ariaLabel={t('miniApp.preview.pane.title')}
                />
              ) : (
                <div style={{ padding: 8 }}>{t('miniApp.preview.pane.starting')}</div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

export default MiniAppPreviewPane
