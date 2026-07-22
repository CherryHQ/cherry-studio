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
 * group ("Processed · Ns"). Collapsed to a one-line "response preparation took Ns"; expands to a
 * per-stage table with a "copy diagnostics" button. Diagnostics carry only non-sensitive fields
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
    <Accordion
      ref={anchorRef}
      type="single"
      collapsible
      value={activeKey}
      onValueChange={(value) => withScrollAnchor(() => setActiveKey(value))}
      className="w-full text-foreground-muted text-xs"
      data-testid="prepare-timeline-block">
      <AccordionItem value="timeline" className="border-0 first:border-t-0">
        <AccordionTrigger className="w-fit flex-none select-none gap-1 py-0.5 font-normal text-foreground-muted text-xs hover:text-foreground [&>svg]:size-3">
          {t('message.tools.placeholder.prepare.footer.summary', { seconds: formatSeconds(timeline.totalMs) })}
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-0">
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background-soft p-2">
            <Table className="text-xs">
              <TableBody>
                {timeline.stages.map((entry, index) => (
                  <TableRow key={`${entry.stage}-${index}`} className="border-0 hover:bg-transparent">
                    <TableCell className="py-0.5 pr-3 font-mono">{entry.stage}</TableCell>
                    <TableCell className="py-0.5 pr-3 text-right tabular-nums">{entry.ms} ms</TableCell>
                    <TableCell className="py-0.5 font-mono text-[11px] text-foreground-muted">
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
  )
}

export default React.memo(PrepareTimelineBlock)
