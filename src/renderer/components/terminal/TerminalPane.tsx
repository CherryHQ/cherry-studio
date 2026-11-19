import { Plus, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Badge, ScrollArea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { TerminalResourceState } from '@shared/types/terminal'

import { TerminalCanvas } from './TerminalCanvas'

export function TerminalPane({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { t } = useTranslation()
  const [resources, setResources] = useState<TerminalResourceState[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [claimId, setClaimId] = useState<string | null>(null)
  const selectedId = useRef(selected)
  selectedId.current = selected
  const [historyLimited, setHistoryLimited] = useState(false)
  const update = useCallback(
    (resource: TerminalResourceState) =>
      setResources((previous) => {
        const old = previous.find((item) => item.id === resource.id)
        if (old && old.revision >= resource.revision) return previous
        return old ? previous.map((item) => (item.id === resource.id ? resource : item)) : [...previous, resource]
      }),
    []
  )
  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const result = await ipcApi.request('terminal.list', { sessionId, selectedId: selectedId.current ?? undefined })
        if (stopped) return
        const next = result.resources
        setHistoryLimited(result.truncated)
        setResources((previous) =>
          next.map((item) => {
            const old = previous.find((candidate) => candidate.id === item.id)
            return old && old.revision > item.revision ? old : item
          })
        )
        setSelected((current) =>
          current && next.some((item) => item.id === current) ? current : (next.at(-1)?.id ?? null)
        )
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (!stopped) timer = setTimeout(() => void load(), 250)
    }
    void load()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [active, sessionId])
  const create = async (shell: 'default' | 'powershell') => {
    setCreating(true)
    try {
      const receipt = await ipcApi.request('terminal.create', { sessionId, shell, operationId: crypto.randomUUID() })
      if (receipt.kind !== 'resource')
        throw new Error(
          t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
        )
      update(receipt.resource)
      setClaimId(receipt.resource.id)
      setSelected(receipt.resource.id)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }
  const resource = resources.find((item) => item.id === selected)
  return (
    <div className="flex size-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <TerminalSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-sm font-medium">{t('terminal.title')}</span>
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={creating}
          onClick={() => void create('default')}>
          <Plus className="size-3.5" aria-hidden="true" />
          {t('terminal.new_terminal')}
        </Button>
        <Button size="sm" variant="ghost" disabled={creating} onClick={() => void create('powershell')}>
          {t('terminal.new_powershell')}
        </Button>
      </div>
      {error && (
        <div role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {historyLimited && <p className="px-3 py-1 text-xs text-muted-foreground">{t('terminal.history_limited')}</p>}
      {resources.length > 0 && (
        <ScrollArea className="max-h-32 shrink-0 border-b">
          <div className="flex flex-wrap gap-1 p-2" role="tablist" aria-label={t('terminal.resources')}>
            {resources.slice(-32).map((item) => (
              <Button
                key={item.id}
                role="tab"
                aria-selected={selected === item.id}
                variant={selected === item.id ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setSelected(item.id)}>
                {item.shell === 'bash'
                  ? 'Bash'
                  : item.shell === 'powershell'
                    ? 'PowerShell'
                    : item.shell === 'zsh'
                      ? 'zsh'
                      : t('terminal.title')}{' '}
                <span className="font-mono text-xs">{item.id.slice(0, 6)}</span>
                <Badge variant="outline" className="text-xs">
                  {t(
                    item.kind === 'pty'
                      ? 'terminal.persistent'
                      : item.retention.kind === 'session'
                        ? 'terminal.background'
                        : 'terminal.command'
                  )}
                </Badge>
              </Button>
            ))}
          </div>
        </ScrollArea>
      )}
      {resource ? (
        <>
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
            role="status">
            <span>
              {t(
                (
                  {
                    not_started: 'terminal.process.not_started',
                    starting: 'terminal.process.starting',
                    running: 'terminal.process.running',
                    closing: 'terminal.process.closing',
                    exited: 'terminal.process.exited',
                    lost: 'terminal.process.lost'
                  } as const
                )[resource.process.kind]
              )}
            </span>
            {resource.process.kind === 'exited' && (
              <span>{t('terminal.exit_code', { code: resource.process.exitCode ?? '—' })}</span>
            )}
            {resource.cleanup !== 'none' && (
              <span>
                {t(
                  (
                    {
                      pending: 'terminal.cleanup.pending',
                      confirmed: 'terminal.cleanup.confirmed',
                      unconfirmed: 'terminal.cleanup.unconfirmed'
                    } as const
                  )[resource.cleanup]
                )}
              </span>
            )}
            {resource.kind === 'pty' && (
              <span>
                {t(
                  (
                    {
                      unknown: 'terminal.shell.unknown',
                      prompt: 'terminal.shell.prompt',
                      program: 'terminal.shell.program'
                    } as const
                  )[resource.shellFacts?.kind ?? 'unknown']
                )}
              </span>
            )}
          </div>
          {resource.kind === 'pty' && (resource.cleanup !== 'confirmed' || resource.screenAvailable) ? (
            <TerminalCanvas
              key={`${resource.host.generation}:${resource.id}`}
              resource={resource}
              active={active}
              onResource={update}
              takeControlOnAttach={claimId === resource.id}
              onAttached={() => setClaimId(null)}
            />
          ) : (
            <TerminalOutput key={resource.id} resource={resource} active={active} onResource={update} />
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
          <TerminalSquare className="size-8" aria-hidden="true" />
          <p>{t('terminal.empty')}</p>
        </div>
      )}
    </div>
  )
}

function TerminalOutput({
  resource,
  active,
  onResource
}: {
  resource: TerminalResourceState
  active: boolean
  onResource: (state: TerminalResourceState) => void
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
  const action = async (promote: boolean) => {
    try {
      const ref = { id: resource.id, host: resource.host }
      const receipt = promote
        ? await ipcApi.request('terminal.promote', {
            ref,
            operationId: crypto.randomUUID(),
            cancelRevision: resource.cancelRevision
          })
        : await ipcApi.request('terminal.stop', {
            ref,
            operationId: crypto.randomUUID(),
            controlRevision: resource.controlRevision,
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {resource.kind === 'pipe' &&
          resource.shell === 'bash' &&
          resource.retention.kind === 'turn' &&
          resource.process.kind === 'running' && (
            <Button size="sm" variant="outline" onClick={() => void action(true)}>
              {t('terminal.run_background')}
            </Button>
          )}
        {resource.cleanup !== 'confirmed' && (
          <Button size="sm" variant="ghost" onClick={() => void action(false)}>
            {t(resource.cleanup === 'unconfirmed' ? 'terminal.retry_close' : 'terminal.stop')}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{t('terminal.output_only')}</span>
      </div>
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
    </div>
  )
}
