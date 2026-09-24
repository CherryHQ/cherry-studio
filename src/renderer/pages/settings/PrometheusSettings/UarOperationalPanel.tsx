import { RefreshCw, Search, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type {
  UarKnowledgeSearchResult,
  UarOperationalSnapshot,
  UarRunDetailSnapshot
} from '@shared/types/prometheusIntegration'

type OperationalSurface = 'runs' | 'knowledge' | 'tools' | 'security' | 'protocols'

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function UarOperationalPanel({ surface }: { surface: OperationalSurface }) {
  const { t } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.operations.${key}`, options)
  const [snapshot, setSnapshot] = useState<UarOperationalSnapshot>()
  const [runDetail, setRunDetail] = useState<UarRunDetailSnapshot>()
  const [ownerId, setOwnerId] = useState('')
  const [kbName, setKbName] = useState('')
  const [kbDescription, setKbDescription] = useState('')
  const [selectedKb, setSelectedKb] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UarKnowledgeSearchResult[]>([])
  const [memory, setMemory] = useState('')
  const [policySource, setPolicySource] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.operations.read', {})
      setSnapshot(next)
      setOwnerId((current) => current || next.owners[0]?.sessionId || '')
      setSelectedKb((current) => current || next.knowledgeBases[0]?.id || '')
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const ownerNames = useMemo(
    () => new Map(snapshot?.owners.map((owner) => [owner.sessionId, `${owner.agentName} · ${owner.sessionName}`])),
    [snapshot]
  )
  const selectedKnowledge = useMemo(
    () => snapshot?.knowledgeBases.find((kb) => kb.ownerSessionId === ownerId && kb.id === selectedKb),
    [ownerId, selectedKb, snapshot]
  )

  const mutate = async (operation: () => Promise<UarOperationalSnapshot>, success: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await operation())
      setStatus(success)
    } catch (mutationError) {
      setError(message(mutationError))
    } finally {
      setBusy(false)
    }
  }

  const inspectRun = async (runId: string) => {
    setBusy(true)
    setError(undefined)
    try {
      const detail = await ipcApi.request('prometheus.uar.runs.read', { runId })
      setRunDetail(detail)
      setPolicySource(JSON.stringify(detail.context.conversationPolicy ?? {}, null, 2))
    } catch (readError) {
      setError(message(readError))
    } finally {
      setBusy(false)
    }
  }

  const cancelRun = async (runId: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setRunDetail(await ipcApi.request('prometheus.uar.runs.cancel', { runId }))
      setStatus(tr('runCancelled'))
      await load()
    } catch (cancelError) {
      setError(message(cancelError))
    } finally {
      setBusy(false)
    }
  }

  const createKnowledge = async () => {
    if (!ownerId || !kbName.trim()) return
    await mutate(
      () =>
        ipcApi.request('prometheus.uar.knowledge.create', {
          sessionId: ownerId,
          name: kbName,
          ...(kbDescription.trim() ? { description: kbDescription } : {})
        }),
      tr('knowledgeCreated')
    )
    setKbName('')
    setKbDescription('')
  }

  const searchKnowledge = async () => {
    if (!ownerId || !selectedKb || !query.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      setResults(
        await ipcApi.request('prometheus.uar.knowledge.search', {
          sessionId: ownerId,
          knowledgeBaseId: selectedKb,
          query
        })
      )
      setStatus(tr('searchComplete'))
    } catch (searchError) {
      setError(message(searchError))
    } finally {
      setBusy(false)
    }
  }

  const createMemory = async () => {
    if (!memory.trim()) return
    await mutate(() => ipcApi.request('prometheus.uar.memory.create', { content: memory }), tr('memoryCreated'))
    setMemory('')
  }

  if (!snapshot) {
    return (
      <SettingGroup>
        <SettingTitle>{t('settings.prometheus.integration.uarAdmin.loadFailed')}</SettingTitle>
        {error && (
          <p className="mt-3 text-sm text-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </SettingGroup>
    )
  }

  return (
    <SettingGroup>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SettingTitle>{t(`settings.prometheus.integration.uarAdmin.surface.${surface}`)}</SettingTitle>
          <SettingDescription>{t('settings.prometheus.integration.uarAdmin.surfaceDescription')}</SettingDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </div>

      {(error || status) && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            error ? 'border-error-border bg-error-subtle text-error-subtle-foreground' : 'border-border bg-accent'
          }`}
          role={error ? 'alert' : 'status'}>
          {error ?? status}
        </div>
      )}

      {surface === 'runs' && (
        <div className="mt-5 space-y-3">
          {snapshot.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('runs.empty')}</p>
          ) : (
            snapshot.runs.map((run) => (
              <div key={run.runId} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{run.agentId}</div>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{run.runId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {ownerNames.get(run.ownerSessionId) ?? run.ownerSessionId}
                    </div>
                  </div>
                  <Badge variant="outline">{tr(`runStatus.${run.status}`)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void inspectRun(run.runId)} disabled={busy}>
                    {tr('inspect')}
                  </Button>
                  {['pending', 'running', 'paused'].includes(run.status) && (
                    <Button variant="outline" size="sm" onClick={() => void cancelRun(run.runId)} disabled={busy}>
                      <Square size={13} aria-hidden="true" />
                      {tr('cancelRun')}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
          {runDetail && (
            <div className="rounded-lg border border-border bg-accent/30 p-3">
              <div className="font-medium">{tr('checkpoints')}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {tr('resolvedAgent', { revision: runDetail.run.agentRevision ?? t('common.unknown') })}
              </div>
              {runDetail.checkpoints.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{tr('noCheckpoints')}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {runDetail.checkpoints.map((checkpoint) => (
                    <li key={checkpoint.id} className="text-sm">
                      <span className="font-medium">{checkpoint.nodeId}</span>{' '}
                      <span className="text-muted-foreground">
                        · {checkpoint.createdAt} · {tr(`checkpoint.${checkpoint.completeness}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-4 border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-medium">{tr('effectiveContext')}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-muted-foreground">
                  {JSON.stringify(runDetail.context, null, 2)}
                </pre>
              </details>
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-2 text-sm font-medium">{tr('conversationPolicy')}</div>
                <Textarea.Input
                  value={policySource}
                  onChange={(event) => setPolicySource(event.target.value)}
                  rows={8}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy(true)
                      setError(undefined)
                      try {
                        const parsed: unknown = JSON.parse(policySource)
                        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
                          throw new Error(tr('policyObject'))
                        const detail = await ipcApi.request('prometheus.uar.runs.save_policy', {
                          runId: runDetail.run.runId,
                          policy: parsed as Record<string, unknown>
                        })
                        setRunDetail(detail)
                        setPolicySource(JSON.stringify(detail.context.conversationPolicy ?? {}, null, 2))
                        setStatus(tr('policySaved'))
                      } catch (policyError) {
                        setError(message(policyError))
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy}>
                    {tr('savePolicy')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setBusy(true)
                      setError(undefined)
                      try {
                        const detail = await ipcApi.request('prometheus.uar.runs.reset_policy', {
                          runId: runDetail.run.runId
                        })
                        setRunDetail(detail)
                        setPolicySource(JSON.stringify(detail.context.conversationPolicy ?? {}, null, 2))
                        setStatus(tr('policyReset'))
                      } catch (policyError) {
                        setError(message(policyError))
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy}>
                    {tr('resetPolicy')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {surface === 'knowledge' && (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={ownerId}
              onValueChange={(value) => {
                setOwnerId(value)
                setSelectedKb('')
              }}>
              <SelectTrigger aria-label={tr('owner')}>
                <SelectValue placeholder={tr('owner')} />
              </SelectTrigger>
              <SelectContent>
                {snapshot.owners.map((owner) => (
                  <SelectItem key={owner.sessionId} value={owner.sessionId}>
                    {owner.agentName} · {owner.sessionName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={kbName}
              onChange={(event) => setKbName(event.target.value)}
              placeholder={tr('knowledgeName')}
            />
            <Textarea.Input
              value={kbDescription}
              onChange={(event) => setKbDescription(event.target.value)}
              placeholder={tr('knowledgeDescription')}
              className="sm:col-span-2"
            />
            <Button onClick={() => void createKnowledge()} disabled={busy || !ownerId || !kbName.trim()}>
              {tr('createKnowledge')}
            </Button>
          </div>
          <div className="space-y-2">
            {snapshot.knowledgeBases
              .filter((kb) => !ownerId || kb.ownerSessionId === ownerId)
              .map((kb) => (
                <div
                  key={`${kb.ownerSessionId}:${kb.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => setSelectedKb(kb.id)}>
                    <div className="font-medium">{kb.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr('documents', { count: kb.documentCount })} · {kb.embeddingProvider}/{kb.embeddingModel}
                    </div>
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-error"
                    onClick={() =>
                      window.confirm(t('common.delete_confirm')) &&
                      void mutate(
                        () =>
                          ipcApi.request('prometheus.uar.knowledge.delete', {
                            sessionId: kb.ownerSessionId,
                            knowledgeBaseId: kb.id
                          }),
                        tr('knowledgeDeleted')
                      )
                    }
                    disabled={busy}>
                    <Trash2 size={13} aria-hidden="true" />
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select value={selectedKb} onValueChange={setSelectedKb}>
              <SelectTrigger aria-label={tr('knowledgeBase')}>
                <SelectValue placeholder={tr('knowledgeBase')} />
              </SelectTrigger>
              <SelectContent>
                {snapshot.knowledgeBases
                  .filter((kb) => !ownerId || kb.ownerSessionId === ownerId)
                  .map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={async () => {
                if (!ownerId || !selectedKb) return
                setBusy(true)
                setError(undefined)
                try {
                  const result = await ipcApi.request('prometheus.uar.knowledge.upload', {
                    sessionId: ownerId,
                    knowledgeBaseId: selectedKb
                  })
                  setSnapshot(result.snapshot)
                  if (!result.cancelled) setStatus(tr('uploadComplete', { filename: result.filename }))
                } catch (uploadError) {
                  setError(message(uploadError))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy || !selectedKb}>
              {tr('uploadDocument')}
            </Button>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr('searchKnowledge')}
            />
            <Button
              variant="outline"
              onClick={() => void searchKnowledge()}
              disabled={busy || !selectedKb || !query.trim()}>
              <Search size={14} aria-hidden="true" />
              {t('common.search')}
            </Button>
          </div>
          {selectedKnowledge && (
            <div className="space-y-2">
              <div className="font-medium">{tr('documents', { count: selectedKnowledge.documents.length })}</div>
              {selectedKnowledge.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr('noDocuments')}</p>
              ) : (
                selectedKnowledge.documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{document.filename}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {document.status} · {document.chunkCount}
                      </div>
                      {document.error && <div className="mt-1 text-xs text-error">{document.error}</div>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tr('deleteDocument')}
                      onClick={() =>
                        window.confirm(t('common.delete_confirm')) &&
                        void mutate(
                          () =>
                            ipcApi.request('prometheus.uar.knowledge.delete_document', {
                              sessionId: selectedKnowledge.ownerSessionId,
                              knowledgeBaseId: selectedKnowledge.id,
                              documentId: document.id
                            }),
                          tr('documentDeleted')
                        )
                      }
                      disabled={busy}>
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
          {results.map((result, index) => (
            <div key={`${result.documentId ?? index}:${index}`} className="rounded-lg border border-border p-3 text-sm">
              <div>{result.content}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {tr('score', { score: result.score.toFixed(3) })}
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-4">
            <div className="mb-2 font-medium">{tr('memory')}</div>
            {!snapshot.memory.enabled && <p className="text-sm text-muted-foreground">{tr('memoryDisabled')}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={memory}
                onChange={(event) => setMemory(event.target.value)}
                placeholder={tr('memoryContent')}
              />
              <Button onClick={() => void createMemory()} disabled={busy || !snapshot.memory.enabled || !memory.trim()}>
                {tr('addMemory')}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {snapshot.memory.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 text-sm">
                    <div>{item.content}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.scope}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tr('deleteMemory')}
                    onClick={() =>
                      window.confirm(t('common.delete_confirm')) &&
                      void mutate(
                        () => ipcApi.request('prometheus.uar.memory.delete', { id: item.id }),
                        tr('memoryDeleted')
                      )
                    }
                    disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {surface === 'tools' && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{tr('toolCount', { count: snapshot.tools.total })}</Badge>
            <Badge variant="outline">{tr('hostControlled')}</Badge>
          </div>
          {snapshot.tools.mcpServers.map((server) => (
            <div
              key={server.name}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="font-medium">{server.name}</span>
              <span className="text-sm text-muted-foreground">
                {server.status} · {tr('toolCount', { count: server.toolCount })}
              </span>
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-sm font-medium">{tr('toolCatalog')}</summary>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {snapshot.tools.names.map((name) => (
                <Badge key={name} variant="outline">
                  {name}
                </Badge>
              ))}
            </div>
          </details>
        </div>
      )}

      {surface === 'security' && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="font-medium">{tr('governance')}</span>
            <Badge variant="outline">{tr(`governanceStatus.${snapshot.security.governance}`)}</Badge>
          </div>
          {snapshot.owners.map((owner) => (
            <div key={owner.sessionId} className="rounded-lg border border-border p-3">
              <div className="font-medium">
                {owner.agentName} · {owner.sessionName}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(snapshot.security.credentialProvidersBySession[owner.sessionId] ?? []).map((provider) => (
                  <Badge key={provider} variant="outline">
                    {provider}
                  </Badge>
                ))}
                {(snapshot.security.credentialProvidersBySession[owner.sessionId] ?? []).length === 0 && (
                  <span className="text-sm text-muted-foreground">{tr('noCredentials')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {surface === 'protocols' && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              A2A ·{' '}
              {snapshot.protocols.a2a === 'available'
                ? t('settings.prometheus.integration.uarAdmin.availability.available')
                : t('settings.prometheus.integration.uarAdmin.adapter.unavailable')}
            </Badge>
            <Badge variant="outline">
              ACP ·{' '}
              {snapshot.protocols.acp === 'available'
                ? t('settings.prometheus.integration.uarAdmin.availability.available')
                : t('settings.prometheus.integration.uarAdmin.adapter.unavailable')}
            </Badge>
            <Badge variant="outline">{tr('federatedSkills', { count: snapshot.protocols.federatedSkills })}</Badge>
          </div>
          {snapshot.protocols.federatedAgents.map((agent) => (
            <div key={agent.id} className="rounded-lg border border-border p-3">
              <div className="font-medium">{agent.name}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">{agent.baseUrl}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline">
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {snapshot.failures
        .filter((failure) => failure.surface === surface)
        .map((failure, index) => (
          <div
            key={`${failure.surface}:${index}`}
            className="mt-3 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-sm"
            role="status">
            {failure.message}
          </div>
        ))}
    </SettingGroup>
  )
}
