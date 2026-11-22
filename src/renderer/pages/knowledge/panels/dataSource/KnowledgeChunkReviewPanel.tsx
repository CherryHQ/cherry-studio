import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { normalizeKnowledgeError } from '@renderer/pages/knowledge/utils/error'
import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'
import type { KnowledgeChunkReviewInput, KnowledgeChunkReviewList } from '@shared/data/types/knowledgeChunkGovernance'

interface Props {
  baseId: string
  itemId: string
  chunks: KnowledgeItemChunk[]
  onChanged: () => Promise<void>
}

const KnowledgeChunkReviewPanel = ({ baseId, itemId, chunks, onChanged }: Props) => {
  const { t } = useTranslation()
  const [view, setView] = useState<KnowledgeChunkReviewList | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [preview, setPreview] = useState<KnowledgeChunkReviewInput | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const scope = `${baseId}:${itemId}`
  const currentScope = useRef({ key: scope })
  if (currentScope.current.key !== scope) currentScope.current = { key: scope }
  const request = useRef<symbol | null>(null)
  const viewScope = useRef<object | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const actionRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async () => {
    const origin = currentScope.current
    const token = Symbol()
    viewScope.current = null
    actionRef.current = null
    request.current = token
    setView(null)
    setPreview(null)
    setError(null)
    setSelectedId('')
    setTargetId('')
    try {
      const result = await ipcApi.request('knowledge.list_chunk_governance_reviews', { baseId, itemId })
      if (request.current === token && currentScope.current === origin) {
        viewScope.current = origin
        setView(result)
        setSelectedId(result.records[0]?.id ?? '')
      }
    } catch (cause) {
      if (request.current === token && currentScope.current === origin) {
        viewScope.current = origin
        setError(normalizeKnowledgeError(cause))
      }
    }
  }, [baseId, itemId])

  useEffect(() => {
    setBusy(false)
    void load()
    return () => {
      request.current = null
    }
  }, [load])
  useEffect(() => {
    if (preview) confirmRef.current?.focus()
    else actionRef.current?.focus()
  }, [preview])

  const record = view?.records.find((row) => row.id === selectedId)
  const target = chunks.find((chunk) => chunk.id === targetId)
  const prepare = (action: KnowledgeChunkReviewInput['action'], button: HTMLElement) => {
    if (!view || !record || busy || error) return
    actionRef.current = button
    setPreview({
      baseId,
      itemId,
      governanceId: record.id,
      expectedRevision: record.revision,
      currentSourceContentHash: view.currentSourceContentHash,
      action
    })
  }
  const apply = async () => {
    if (!preview || busy) return
    const origin = currentScope.current
    setBusy(true)
    try {
      await ipcApi.request('knowledge.review_chunk_governance', preview)
      if (currentScope.current === origin && request.current !== null) {
        setPreview(null)
        await onChanged()
      }
    } catch (cause) {
      if (currentScope.current === origin && request.current !== null) {
        setError(normalizeKnowledgeError(cause))
        setPreview(null)
        setTargetId('')
      }
    } finally {
      if (currentScope.current === origin && request.current !== null) setBusy(false)
    }
  }
  if (viewScope.current !== currentScope.current || (!error && !view?.records.length)) return null
  return (
    <section
      aria-label={t('knowledge.governance.review')}
      className="max-h-[60%] shrink-0 space-y-2 overflow-y-auto border-b border-border bg-background-subtle px-4 py-3 text-sm">
      {!error && view?.records.some((row) => !row.retired) ? (
        <p role="status" className="text-warning-subtle-foreground">
          {t('knowledge.governance.review_paused')}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="break-words text-error-subtle-foreground">
          {error.message}
        </div>
      ) : null}
      {error ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      ) : null}
      {record ? (
        <>
          <Select
            value={selectedId}
            disabled={busy || !!preview || !!error}
            onValueChange={(id) => {
              setSelectedId(id)
              setTargetId('')
            }}>
            <SelectTrigger aria-label={t('knowledge.governance.review_select')} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {view!.records.map((row, index) => (
                <SelectItem key={row.id} value={row.id}>
                  {index + 1}: {row.originalText.slice(0, 80)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs break-all text-muted-foreground">
            {record.sourceContentHash} · {record.charStart}-{record.charEnd} ·{' '}
            {t('knowledge.governance.review_revision', { revision: record.revision })}
          </p>
          <p className="text-xs text-muted-foreground">{t('knowledge.governance.review_original')}</p>
          <pre className="max-h-24 overflow-auto font-sans text-sm break-words whitespace-pre-wrap">
            {record.originalText}
          </pre>
          <p className="text-xs break-words text-muted-foreground">
            {record.state.excluded ? t('knowledge.governance.excluded') : t('knowledge.governance.active')}
            {record.state.labels.length ? ` · ${record.state.labels.join(', ')}` : ''}
          </p>
          {record.state.overrideText !== null ? (
            <>
              <p className="text-xs text-muted-foreground">{t('knowledge.governance.pending')}</p>
              <pre className="max-h-24 overflow-auto font-sans text-sm break-words whitespace-pre-wrap">
                {record.state.overrideText}
              </pre>
            </>
          ) : null}
          {!record.retired && chunks.some((chunk) => chunk.id !== record.unitId) ? (
            <>
              <Select value={targetId} disabled={busy || !!preview || !!error} onValueChange={setTargetId}>
                <SelectTrigger aria-label={t('knowledge.governance.review_target')} className="w-full min-w-0">
                  <SelectValue placeholder={t('common.select')} />
                </SelectTrigger>
                <SelectContent>
                  {chunks
                    .filter((chunk) => chunk.id !== record.unitId)
                    .map((chunk) => (
                      <SelectItem key={chunk.id} value={chunk.id}>
                        {chunk.metadata.chunkIndex + 1}: {chunk.content.slice(0, 80)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {target ? (
                <>
                  <p className="text-xs text-muted-foreground">{t('knowledge.governance.review_current')}</p>
                  <pre className="max-h-24 overflow-auto font-sans text-sm break-words whitespace-pre-wrap">
                    {target.content}
                  </pre>
                </>
              ) : null}
            </>
          ) : !record.retired ? (
            <p className="text-muted-foreground">{t('knowledge.governance.review_empty_target')}</p>
          ) : (
            <p>{t('knowledge.governance.restore_explain')}</p>
          )}
          {preview ? (
            <div className="space-y-2 border-t border-border pt-2">
              <p>
                {t(
                  preview.action.kind === 'restore'
                    ? 'knowledge.governance.restore_confirm'
                    : preview.action.kind === 'discard'
                      ? 'knowledge.governance.review_confirm_discard'
                      : 'knowledge.governance.review_confirm_rebind'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button ref={confirmRef} size="sm" disabled={busy} onClick={() => void apply()}>
                  {busy ? t('common.loading') : t('common.save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setPreview(null)
                  }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
          {record.retired ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !!preview || !!error}
              onClick={(event) => prepare({ kind: 'restore' }, event.currentTarget)}>
              {t('knowledge.governance.restore_discard')}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!preview || !!error}
                onClick={(event) => prepare({ kind: 'discard' }, event.currentTarget)}>
                {t('knowledge.governance.review_discard')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!preview || !!error || !target?.governance}
                onClick={(event) => {
                  if (target?.governance)
                    prepare(
                      { kind: 'rebind', targetUnitId: target.id, expectedTargetRevision: target.governance.revision },
                      event.currentTarget
                    )
                }}>
                {t('knowledge.governance.review_rebind')}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}

export default KnowledgeChunkReviewPanel
