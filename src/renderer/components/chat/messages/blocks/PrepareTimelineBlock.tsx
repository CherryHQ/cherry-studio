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
import { buildPrepareDiagnostics, type PrepareTimeline } from '@shared/ai/agentPrepareTimeline'
import { Copy } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useScrollAnchor } from './useScrollAnchor'

function formatSeconds(ms: number): number {
  return Math.round(ms / 100) / 10
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
              <Table>
                <TableBody>
                  {timeline.stages.map((entry, index) => (
                    <TableRow key={`${entry.stage}-${index}`} className="border-0 hover:bg-transparent">
                      <TableCell className="py-0.5 pr-3 font-mono">{entry.stage}</TableCell>
                      <TableCell className="py-0.5 pr-3 text-right tabular-nums">{entry.ms} ms</TableCell>
                      <TableCell className="py-0.5 font-mono text-foreground-muted text-xs">
                        {entry.detail ? JSON.stringify(entry.detail) : ''}
                      </TableCell>
                    </TableRow>
                  ))}
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
