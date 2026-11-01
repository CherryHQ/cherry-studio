import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Spinner } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'
import type { EventPayload } from '@shared/ipc/types'

const logger = loggerService.withContext('McpResourcePreview')

export default function McpResourcePreview({ serverId, uri }: { serverId: string; uri: string }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<OutputFor<'mcp.server.read_resource_preview'>>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [subscription, setSubscription] =
    useState<Exclude<EventPayload<'mcp.resource.changed'>['state'], 'updated'>>('reconnecting')

  useEffect(() => {
    const requestId = crypto.randomUUID()
    let active = true
    const unsubscribe = ipcApi.on('mcp.resource.changed', (event) => {
      if (event.requestId !== requestId || !active) return
      if (event.state === 'updated' || event.state === 'subscribed') setRevision((value) => value + 1)
      if (event.state !== 'updated') setSubscription(event.state)
    })
    void ipcApi.request('mcp.resource.observe', { serverId, uri, requestId }).catch(() => {
      if (active) setSubscription('closed')
    })
    return () => {
      active = false
      unsubscribe()
      void ipcApi.request('mcp.request.cancel', { requestId }).catch(() => undefined)
    }
  }, [serverId, uri])

  useEffect(() => {
    const requestId = crypto.randomUUID()
    let active = true
    setFailed(false)
    void ipcApi
      .request('mcp.server.read_resource_preview', {
        serverId,
        uri,
        requestId,
        maxChars: 16_384,
        refresh: revision > 0
      })
      .then(
        (result) => {
          if (active) setPreview(result)
        },
        (error) => {
          if (active) {
            setFailed(true)
            logger.warn('MCP resource preview failed', { serverId, error })
          }
        }
      )
    return () => {
      active = false
      void ipcApi.request('mcp.request.cancel', { requestId }).catch(() => undefined)
    }
  }, [serverId, uri, revision])

  return (
    <section className="flex flex-col gap-2 py-2" aria-label={t('common.preview')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {
            {
              subscribed: t('settings.mcp.observation.subscribed'),
              reconnecting: t('settings.mcp.observation.reconnecting'),
              unsupported: t('settings.mcp.observation.unsupported'),
              closed: t('settings.mcp.observation.closed')
            }[subscription]
          }
        </span>
        <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
          {t('common.refresh')}
        </Button>
      </div>
      {failed ? (
        <Alert type="error" message={t('common.error')} />
      ) : !preview ? (
        <Spinner text={t('common.loading')} />
      ) : (
        <>
          {preview.isBinary ? (
            <p>{t('settings.mcp.resources.blobInvisible')}</p>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 text-sm">
              {preview.text}
            </pre>
          )}
          {preview.totalChars > preview.text.length ? (
            <Alert type="warning" message={t('settings.mcp.instructions.truncated')} />
          ) : null}
        </>
      )}
    </section>
  )
}
