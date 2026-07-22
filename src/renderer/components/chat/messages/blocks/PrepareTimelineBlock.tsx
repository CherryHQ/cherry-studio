import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Table,
  TableBody,
  TableCell,
  TableRow
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import {
  buildPrepareDiagnostics,
  type PrepareStageDetail,
  type PrepareTimeline,
  type PrepareTimelineStageEntry
} from '@shared/ai/agentPrepareTimeline'
import type { TFunction } from 'i18next'
import { Copy } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useScrollAnchor } from './useScrollAnchor'

function formatSeconds(ms: number): number {
  return Math.round(ms / 100) / 10
}

/** Localized "why" note for the known (closed-set) detail flags; unknown fields stay copy-only. */
function stageNote(detail: PrepareStageDetail | undefined, t: TFunction): string {
  if (!detail) return ''
  const parts: string[] = []
  if (typeof detail.serverCount === 'number') {
    parts.push(t('message.tools.placeholder.prepare.footer.detail.mcpServers', { count: detail.serverCount }))
  }
  if (detail.mcpServerName) parts.push(detail.mcpServerName)
  if (detail.completedInTime === false) parts.push(t('message.tools.placeholder.prepare.footer.detail.mcpTimeout'))
  if (detail.shellEnvColdFetch) parts.push(t('message.tools.placeholder.prepare.footer.detail.shellEnvCold'))
  if (detail.warmQuery) {
    parts.push(t(`message.tools.placeholder.prepare.footer.detail.warmQuery.${detail.warmQuery}`))
  }
  return parts.join(' · ')
}

/** Waterfall geometry: each stage's offset is the sum of the stages before it. */
function stageBars(stages: PrepareTimelineStageEntry[], totalMs: number): { leftPct: number; widthPct: number }[] {
  let elapsed = 0
  return stages.map((entry) => {
    const leftPct = totalMs > 0 ? Math.min((elapsed / totalMs) * 100, 99) : 0
    const widthPct = totalMs > 0 && entry.ms > 0 ? Math.max((entry.ms / totalMs) * 100, 1) : 0
    elapsed += entry.ms
    return { leftPct, widthPct }
  })
}

interface PrepareTimelineBlockProps {
  timeline: PrepareTimeline
}

/**
 * The prepare segment of the turn's activity timeline, rendered as the first row inside the process
 * group ("Processed · Ns"). Styled after its process-group siblings: a ThinkingBlock-like title row
 * (hover-revealed chevron, 13px secondary text) collapsing a ThinkingBlock-like muted panel with the
 * per-stage table and a "copy diagnostics" button. Diagnostics carry only non-sensitive fields
 * (stage breakdown, app version, agent type, MCP server names) — never env vars, keys, or base URLs.
 */
const PrepareTimelineBlock: React.FC<PrepareTimelineBlockProps> = ({ timeline }) => {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState('')
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const bars = stageBars(timeline.stages, timeline.totalMs)

  const handleCopy = useCallback(async () => {
    try {
      const info = await ipcApi.request('app.get_info')
      const diagnostics = buildPrepareDiagnostics({ timeline, appVersion: info?.version ?? 'unknown' })
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      toast.success(t('message.copied'))
    } catch {
      toast.error(t('common.copy_failed'))
    }
  }, [timeline, t])

  return (
    <div ref={anchorRef} className="w-full max-w-full" data-testid="prepare-timeline-block">
      <Accordion
        type="single"
        collapsible
        value={activeKey}
        onValueChange={(value) => withScrollAnchor(() => setActiveKey(value), { settleAfterMs: 220 })}>
        <AccordionItem value="timeline" className="border-0 first:border-t-0">
          <AccordionTrigger className="[&>svg]:-rotate-90 h-auto min-h-7 w-fit max-w-full flex-none select-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal text-[13px] text-foreground-secondary leading-5 shadow-none hover:no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0 [&>svg]:size-3.5 [&>svg]:opacity-0 [&>svg]:transition-[transform,opacity] hover:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60 [&[data-state=open]>svg]:rotate-0 [&[data-state=open]>svg]:opacity-60">
            {t('message.tools.placeholder.prepare.footer.summary', { seconds: formatSeconds(timeline.totalMs) })}
          </AccordionTrigger>
          <AccordionContent
            className="px-0 pt-1.5 pb-0 text-inherit"
            contentClassName="text-inherit motion-safe:data-[state=open]:[animation-duration:200ms] motion-safe:data-[state=closed]:[animation-duration:160ms] motion-reduce:animate-none">
            <div className="flex max-h-96 flex-col items-start gap-2 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground-secondary leading-5">
              <Table className="w-auto">
                <TableBody>
                  {timeline.stages.map((entry, index) => {
                    const bar = bars[index]
                    return (
                      <TableRow key={`${entry.stage}-${index}`} className="border-0 hover:bg-transparent">
                        <TableCell className="whitespace-nowrap py-0.5 pr-4">
                          {t(`message.tools.placeholder.prepare.footer.stage.${entry.stage}`)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-0.5 pr-4 text-right tabular-nums">
                          {entry.ms} ms
                        </TableCell>
                        <TableCell className="w-32 min-w-32 py-0.5 pr-4">
                          <div className="relative h-1.5 w-full">
                            {bar.widthPct > 0 && (
                              <div
                                className="absolute h-full rounded-full bg-foreground-muted"
                                style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-0.5 text-foreground-muted text-xs">
                          {stageNote(entry.detail, t)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Button variant="ghost" size="sm" className="w-fit gap-1" onClick={handleCopy}>
                <Copy size={12} />
                {t('message.tools.placeholder.prepare.footer.copy')}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

export default React.memo(PrepareTimelineBlock)
