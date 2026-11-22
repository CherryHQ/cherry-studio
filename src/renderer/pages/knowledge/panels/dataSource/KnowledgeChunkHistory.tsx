import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import {
  KnowledgeChunkHistoryPageSchema,
  type KnowledgeChunkHistoryPage
} from '@shared/data/types/knowledgeChunkGovernance'

export function KnowledgeChunkHistory({
  baseId,
  itemId,
  unitId,
  revision
}: {
  baseId: string
  itemId: string
  unitId: string
  revision: number
}) {
  return (
    <History key={JSON.stringify([baseId, itemId, unitId, revision])} baseId={baseId} itemId={itemId} unitId={unitId} />
  )
}

function History({ baseId, itemId, unitId }: { baseId: string; itemId: string; unitId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<KnowledgeChunkHistoryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const request = useRef<symbol | null>(null)
  useEffect(
    () => () => {
      request.current = null
    },
    []
  )
  const load = async (beforeRevision?: number) => {
    const token = Symbol()
    request.current = token
    setPage(null)
    setLoading(true)
    setError(false)
    try {
      const result = KnowledgeChunkHistoryPageSchema.parse(
        await dataApiService.get(
          `/knowledge-bases/${encodeURIComponent(baseId)}/items/${encodeURIComponent(itemId)}/chunks/${encodeURIComponent(unitId)}/history`,
          { query: { limit: 5, ...(beforeRevision ? { beforeRevision } : {}) } }
        )
      )
      if (!result.binding && result.items.length) throw new Error('History binding missing')
      if (result.items.some((entry) => entry.revision > (result.binding?.revision ?? 0)))
        throw new Error('History revision changed')
      if (result.items.length > 5) throw new Error('History page exceeds request')
      if (result.binding && result.binding.unitId !== unitId) throw new Error('History scope changed')
      if (request.current === token) setPage(result)
    } catch {
      if (request.current === token) setError(true)
    } finally {
      if (request.current === token) setLoading(false)
    }
  }
  return (
    <section className="space-y-2 px-3 pb-3 text-xs" aria-label={t('knowledge.governance.history')}>
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            request.current = null
            setPage(null)
            setLoading(false)
            setError(false)
            setOpen(false)
          } else {
            setOpen(true)
            void load()
          }
        }}>
        {t('knowledge.governance.history')}
      </Button>
      {open ? (
        <div className="space-y-2 break-words">
          <p className="text-muted-foreground">{t('knowledge.governance.history_explain')}</p>
          {loading ? <p role="status">{t('common.loading')}</p> : null}
          {error ? (
            <>
              <p role="alert">{t('knowledge.governance.history_error')}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('common.refresh')}
              </Button>
            </>
          ) : null}
          {page && !loading && !error ? (
            <>
              {page.binding ? (
                <>
                  <p className="break-all text-muted-foreground">
                    {page.binding.sourceContentHash} · {page.binding.charStart}-{page.binding.charEnd}
                  </p>
                  <p>{t('knowledge.governance.history_original')}</p>
                  <pre className="max-h-28 overflow-auto font-sans break-words whitespace-pre-wrap">
                    {page.binding.originalText}
                  </pre>
                  {page.binding.retired ? <p>{t('knowledge.governance.history_retired')}</p> : null}
                </>
              ) : null}
              {!page.items.length ? <p>{t('knowledge.governance.history_empty')}</p> : null}
              {page.items.map((entry) => (
                <article key={entry.revision} className="space-y-1 border-t border-border pt-2">
                  <h4>
                    {t('knowledge.governance.review_revision', { revision: entry.revision })} ·{' '}
                    {t(
                      {
                        edit: 'knowledge.governance.history_edit',
                        discard: 'knowledge.governance.history_discard',
                        'rebind-away': 'knowledge.governance.history_rebind_away',
                        'rebind-from': 'knowledge.governance.history_rebind_from',
                        'restore-discard': 'knowledge.governance.history_restore'
                      }[entry.operation]
                    )}
                  </h4>
                  <time
                    dateTime={new Date(entry.createdAt).toISOString()}
                    className="block break-all text-muted-foreground">
                    {new Date(entry.createdAt).toISOString()}
                  </time>
                  <p>
                    {t(
                      entry.state.excluded
                        ? 'knowledge.governance.excluded'
                        : 'knowledge.governance.history_not_excluded'
                    )}
                  </p>
                  {entry.state.labels.length ? (
                    <p>
                      {t('knowledge.governance.label')}: {entry.state.labels.join(', ')}
                    </p>
                  ) : null}
                  {entry.state.overrideText !== null ? (
                    <>
                      <p>{t('knowledge.governance.history_override')}</p>
                      <pre className="max-h-28 overflow-auto font-sans break-words whitespace-pre-wrap">
                        {entry.state.overrideText}
                      </pre>
                    </>
                  ) : null}
                  {entry.relatedGovernanceId ? (
                    <p className="break-all text-muted-foreground">
                      {t('knowledge.governance.history_related', { id: entry.relatedGovernanceId })}
                    </p>
                  ) : null}
                </article>
              ))}
              {page.nextBeforeRevision ? (
                <Button size="sm" variant="outline" onClick={() => void load(page.nextBeforeRevision)}>
                  {t('knowledge.governance.history_older')}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
