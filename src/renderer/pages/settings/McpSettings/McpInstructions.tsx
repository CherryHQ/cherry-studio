import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Spinner } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { McpServerInstructions } from '@shared/types/mcp'

const logger = loggerService.withContext('McpInstructions')

export default function McpInstructions({ serverId, connectionState }: { serverId: string; connectionState: string }) {
  const { t } = useTranslation()
  const [instructions, setInstructions] = useState<McpServerInstructions>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    setFailed(false)
    setInstructions(undefined)
    void ipcApi.request('mcp.server.get_instructions', { serverId }).then(
      (result) => {
        if (current) {
          setInstructions(result)
          setLoading(false)
        }
      },
      (error) => {
        logger.warn('Failed to read MCP instructions', { serverId, error })
        if (current) {
          setFailed(true)
          setLoading(false)
        }
      }
    )
    return () => {
      current = false
    }
  }, [serverId, connectionState, revision])

  return (
    <section className="flex flex-col gap-3 py-3" aria-label={t('settings.mcp.instructions.title')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('settings.mcp.instructions.title')}</h3>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {t('common.refresh')}
        </Button>
      </div>
      {loading ? (
        <Spinner text={t('common.loading')} />
      ) : failed ? (
        <Alert type="error" message={t('common.error')} />
      ) : instructions ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t('settings.mcp.instructions.source', { name: instructions.serverName })}
          </p>
          {instructions.truncated ? <Alert type="warning" message={t('settings.mcp.instructions.truncated')} /> : null}
          <pre className="m-0 whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 text-sm">
            {instructions.text}
          </pre>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('settings.mcp.instructions.empty')}</p>
      )}
    </section>
  )
}
