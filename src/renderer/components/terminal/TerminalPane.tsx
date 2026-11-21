import { TerminalSquare } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { TerminalResourceState } from '@shared/types/terminal'
import type { WorkspaceUsageRecord } from '@shared/types/workspaceUsage'

import { TerminalCanvas } from './TerminalCanvas'
import { useTerminalResources } from './TerminalResourcesProvider'

export function TerminalPane({
  active,
  renderHeader
}: {
  sessionId: string
  active: boolean
  renderHeader?: (controls: ReactNode) => ReactNode
}) {
  const { t } = useTranslation()
  const terminal = useTerminalResources()
  const resource = terminal.resources.find((item) => item.id === terminal.tabs.selectedTerminalId)
  const cleanup = terminal.cleanupTabs.find((item) => item.id === terminal.selectedCleanupId)
  const lastTerminal = terminal.tabs.terminals
    .filter((item) => !terminal.tabs.hiddenTerminalIds.includes(item.id))
    .at(-1)
  const show = terminal.show
  useEffect(() => {
    if (active && !terminal.tabs.selectedTerminalId && !terminal.selectedCleanupId && lastTerminal)
      show(lastTerminal.id, lastTerminal.title)
  }, [active, terminal.tabs.selectedTerminalId, terminal.selectedCleanupId, lastTerminal, show])
  return (
    <div className="flex size-full min-h-0 flex-col bg-background text-foreground">
      {terminal.error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {terminal.error}
        </p>
      )}
      {terminal.cleanup.data?.recoveryFailed && (
        <p role="alert" className="px-3 py-2 text-xs text-warning">
          {t('terminal.cleanup.protected')}
        </p>
      )}
      {cleanup ? (
        <CleanupRecord key={cleanup.id} record={cleanup} />
      ) : resource ? (
        <>
          {resource.kind === 'pty' && (resource.cleanup !== 'confirmed' || resource.screenAvailable) ? (
            <TerminalCanvas
              key={`${resource.host.generation}:${resource.id}`}
              resource={resource}
              active={active}
              onResource={terminal.update}
              takeControlOnAttach={terminal.claimId === resource.id}
              onAttached={terminal.clearClaim}
              renderHeader={renderHeader}
              onClose={() => void terminal.close(resource.id)}
              closing={terminal.closingIds.includes(resource.id)}
            />
          ) : (
            <TerminalOutput
              key={resource.id}
              resource={resource}
              active={active}
              onResource={terminal.update}
              onClose={() => void terminal.close(resource.id)}
              closing={terminal.closingIds.includes(resource.id)}
            />
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
          <TerminalSquare className="size-8" aria-hidden />
          <p>{t(terminal.tabs.selectedTerminalId ? 'terminal.unavailable' : 'terminal.empty')}</p>
          <Button variant="outline" size="sm" disabled={terminal.creating} onClick={() => void terminal.create()}>
            {t('terminal.new_terminal')}
          </Button>
        </div>
      )}
    </div>
  )
}

function CleanupRecord({ record }: { record: WorkspaceUsageRecord }) {
  const { t } = useTranslation()
  const terminal = useTerminalResources()
  const [status, setStatus] = useState<'confirmed' | 'unconfirmed' | 'unavailable'>('unconfirmed')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retry = async () => {
    setPending(true)
    try {
      const result = await ipcApi.request('terminal.cleanup.retry', { id: record.id })
      setStatus(result.status)
      await terminal.cleanup.mutate()
      setError(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-sm">
      <p role="status" className={status === 'confirmed' ? 'text-muted-foreground' : 'text-warning'}>
        {t(status === 'confirmed' ? 'terminal.cleanup.confirmed' : 'terminal.cleanup.unconfirmed')}
      </p>
      <p className="break-all font-mono text-xs text-muted-foreground">{record.cwd}</p>
      {status !== 'confirmed' && <p className="text-muted-foreground">{t('terminal.cleanup.protected')}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {status !== 'confirmed' && (
        <Button className="self-start" variant="outline" size="sm" disabled={pending} onClick={() => void retry()}>
          {t('terminal.retry_close')}
        </Button>
      )}
    </div>
  )
}

function TerminalOutput({
  resource,
  active,
  onResource,
  onClose,
  closing
}: {
  resource: TerminalResourceState
  active: boolean
  onResource: (state: TerminalResourceState) => void
  onClose: () => void
  closing: boolean
}) {
  const { t } = useTranslation()
  const [output, setOutput] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { conversationId, generation } = resource.host
  useEffect(() => {
    if (!active) return
    let stopped = false
    let cursor = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setOutput('')
    setTruncated(false)
    const read = async () => {
      try {
        const result = await ipcApi.request('terminal.read', {
          ref: { id: resource.id, host: { conversationId, generation } },
          cursor
        })
        if (stopped) return
        cursor = result.next
        setTruncated((old) => old || result.truncated)
        setOutput((old) => (old + result.output).slice(-64 * 1024))
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (!stopped) timer = setTimeout(() => void read(), 150)
    }
    void read()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [active, resource.id, conversationId, generation])
  const promote = async () => {
    try {
      const ref = { id: resource.id, host: resource.host }
      const receipt = await ipcApi.request('terminal.promote', {
        ref,
        operationId: crypto.randomUUID(),
        cancelRevision: resource.cancelRevision
      })
      if (receipt.kind !== 'resource')
        throw new Error(
          t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
        )
      onResource(receipt.resource)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(resource.cleanup === 'unconfirmed' || resource.process.kind === 'lost') && (
        <p role="alert" className="px-3 py-2 text-xs text-warning">
          {t('terminal.cleanup.protected')}
        </p>
      )}
      {error && (
        <div role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {truncated && <p className="px-3 py-1 text-xs text-muted-foreground">{t('terminal.output_truncated')}</p>}
      <ScrollArea className="min-h-0 flex-1">
        <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs" aria-label={t('terminal.output')}>
          {output}
        </pre>
      </ScrollArea>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
        {resource.kind === 'pipe' &&
          resource.shell === 'bash' &&
          resource.retention.kind === 'turn' &&
          resource.process.kind === 'running' && (
            <Button size="sm" variant="outline" onClick={() => void promote()}>
              {t('terminal.run_background')}
            </Button>
          )}
        {resource.cleanup !== 'confirmed' && (
          <Button size="sm" variant="ghost" disabled={closing} onClick={onClose}>
            {t(resource.cleanup === 'unconfirmed' ? 'terminal.retry_close' : 'terminal.stop')}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{t('terminal.output_only')}</span>
      </div>
    </div>
  )
}
